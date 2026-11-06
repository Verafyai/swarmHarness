//! `ledger`: balances per account and token, for the payment router's ledger mode.
//!
//! The table (account 0) is `u32 count`, then `count` entries of a 32-byte key
//! (SHA-256 of the account and token, computed by the caller) and a u64 balance.
//! Its capacity is however many entries the account's data holds.
//!
//! Instructions:
//! * `0 apply`: data carries a transfer list (`u32 m`, then m × key and i64 delta).
//! * `1 apply_account`: the transfer list is account 1, read only (an exit program's output).
//!
//! A diff must sum to exactly zero. Entries apply in order; a balance can never
//! go below zero; a key not yet in the table is appended (zero deltas are skipped).
#![cfg_attr(target_os = "solana", no_std)]

use abi::{err, Input, Reader};

/// A debit larger than the balance.
pub const INSUFFICIENT: u64 = 100;

const ENTRY: usize = 40;

fn balance_at(table: &[u8], i: usize) -> u64 {
    let o = 4 + i * ENTRY + 32;
    let mut a = [0u8; 8];
    a.copy_from_slice(&table[o..o + 8]);
    u64::from_le_bytes(a)
}

/// Apply a transfer list to the table.
pub fn apply(table: &mut [u8], list: &[u8]) -> Result<(), u64> {
    if table.len() < 4 {
        return Err(err::SMALL_ACCOUNT);
    }
    let cap = (table.len() - 4) / ENTRY;
    let mut count = u32::from_le_bytes([table[0], table[1], table[2], table[3]]) as usize;
    if count > cap {
        return Err(err::BAD_ACCOUNTS);
    }
    let mut r = Reader::new(list);
    let m = r.u32()? as usize;
    // Conservation first, before anything is written.
    let mut check = Reader::new(r.bytes(m.checked_mul(ENTRY).ok_or(err::BAD_INPUT)?)?);
    let mut sum: i128 = 0;
    for _ in 0..m {
        check.key()?;
        sum += check.i64()? as i128;
    }
    if sum != 0 {
        return Err(err::NOT_CONSERVED);
    }
    let mut r = Reader::new(&list[4..4 + m * ENTRY]);
    for _ in 0..m {
        let k = r.key()?;
        let d = r.i64()?;
        if d == 0 {
            continue;
        }
        let found = (0..count).find(|&i| table[4 + i * ENTRY..4 + i * ENTRY + 32] == k);
        let i = match found {
            Some(i) => i,
            None => {
                if d < 0 {
                    return Err(INSUFFICIENT);
                }
                if count == cap {
                    return Err(err::SMALL_ACCOUNT);
                }
                let o = 4 + count * ENTRY;
                table[o..o + 32].copy_from_slice(&k);
                table[o + 32..o + 40].copy_from_slice(&0u64.to_le_bytes());
                count += 1;
                count - 1
            }
        };
        let b = balance_at(table, i);
        let nb = if d < 0 {
            b.checked_sub(d.unsigned_abs()).ok_or(INSUFFICIENT)?
        } else {
            b.checked_add(d as u64).ok_or(err::OVERFLOW)?
        };
        let o = 4 + i * ENTRY + 32;
        table[o..o + 8].copy_from_slice(&nb.to_le_bytes());
    }
    table[0..4].copy_from_slice(&(count as u32).to_le_bytes());
    Ok(())
}

pub fn process(ix: &mut Input) -> Result<(), u64> {
    let mut r = Reader::new(ix.data);
    match r.u8()? {
        0 => {
            ix.expect(1)?;
            let rest = r.bytes(ix.data.len() - 1)?;
            let m = Reader::new(rest).u32()? as usize;
            if rest.len() != 4 + m * ENTRY {
                return Err(err::BAD_INPUT);
            }
            apply(ix.take_owned(0)?, rest)
        }
        1 => {
            ix.expect(2)?;
            r.end()?;
            let table = ix.take_owned(0)?;
            let list = ix.take_read(1)?;
            apply(table, list)
        }
        _ => Err(err::BAD_INPUT),
    }
}

abi::entrypoint!(process);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conserves_and_never_goes_negative() {
        let mut t = [0u8; 4 + 4 * ENTRY];
        let (a, b) = ([1u8; 32], [2u8; 32]);
        let mut l = [0u8; abi::TRANSFERS_ACCOUNT];
        abi::write_transfers(&mut l, &[(a, -5), (b, 5)]).unwrap();
        assert_eq!(apply(&mut t, &l[..4 + 2 * ENTRY]), Err(INSUFFICIENT));
        // A list that does not sum to zero is refused before anything is written.
        let mut bad = [0u8; 4 + ENTRY];
        bad[0] = 1;
        bad[4..36].copy_from_slice(&a);
        bad[36..44].copy_from_slice(&7i64.to_le_bytes());
        assert_eq!(apply(&mut t, &bad), Err(err::NOT_CONSERVED));
        abi::write_transfers(&mut l, &[(b, -5), (a, 5)]).unwrap();
        // b has nothing yet
        assert_eq!(apply(&mut t, &l[..4 + 2 * ENTRY]), Err(INSUFFICIENT));
    }
}
