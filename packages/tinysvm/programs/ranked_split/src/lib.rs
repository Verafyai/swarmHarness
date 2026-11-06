//! `ranked_split`: split a prize by the jury's ranking.
//!
//! Instruction `0 split`: prize (u64), places k (u8), k shares in parts per
//! million (u32 each, summing to 1,000,000), entrants n (u8), the ranking (k
//! distinct u8 indexes into the entrants, first place first), the pot key, then
//! n entrant keys. Place i gets floor(prize × share_i / 1e6); the rounding dust
//! goes to first place, so the whole prize is paid. Accounts: transfer list (0).
#![cfg_attr(target_os = "solana", no_std)]

use abi::{err, write_transfers, Input, Reader, MAX_TRANSFERS};

pub const PPM: u64 = 1_000_000;

pub fn split(out: &mut [u8], prize: u64, shares: &[u32], ranking: &[u8], pot: [u8; 32], entrants: &[[u8; 32]]) -> Result<(), u64> {
    let k = shares.len();
    let n = entrants.len();
    if k == 0 || k != ranking.len() || k > n || k + 1 > MAX_TRANSFERS {
        return Err(err::BAD_INPUT);
    }
    if shares.iter().map(|s| *s as u64).sum::<u64>() != PPM {
        return Err(err::BAD_INPUT);
    }
    let mut seen = [false; 256];
    for &r in ranking {
        if r as usize >= n || seen[r as usize] {
            return Err(err::OUT_OF_BOUNDS);
        }
        seen[r as usize] = true;
    }
    if prize > i64::MAX as u64 {
        return Err(err::OVERFLOW);
    }
    let mut list = [([0u8; 32], 0i64); MAX_TRANSFERS];
    list[0] = (pot, -(prize as i64));
    let mut total: u64 = 0;
    for i in 0..k {
        let p = ((prize as u128) * (shares[i] as u128) / (PPM as u128)) as u64;
        total += p;
        list[i + 1] = (entrants[ranking[i] as usize], p as i64);
    }
    list[1].1 += (prize - total) as i64;
    write_transfers(out, &list[..k + 1])
}

pub fn process(ix: &mut Input) -> Result<(), u64> {
    ix.expect(1)?;
    let mut r = Reader::new(ix.data);
    if r.u8()? != 0 {
        return Err(err::BAD_INPUT);
    }
    let prize = r.u64()?;
    let k = r.u8()? as usize;
    if k == 0 || k + 1 > MAX_TRANSFERS {
        return Err(err::BAD_INPUT);
    }
    let mut shares = [0u32; MAX_TRANSFERS];
    for s in shares.iter_mut().take(k) {
        *s = r.u32()?;
    }
    let n = r.u8()? as usize;
    if n > 32 {
        return Err(err::BAD_INPUT);
    }
    let ranking = r.bytes(k)?;
    let pot = r.key()?;
    let mut entrants = [[0u8; 32]; 32];
    for e in entrants.iter_mut().take(n) {
        *e = r.key()?;
    }
    r.end()?;
    split(ix.take_owned(0)?, prize, &shares[..k], ranking, pot, &entrants[..n])
}

abi::entrypoint!(process);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_the_whole_prize_by_rank() {
        let mut out = [0u8; abi::TRANSFERS_ACCOUNT];
        let e = [[1u8; 32], [2u8; 32], [3u8; 32], [4u8; 32]];
        split(&mut out, 1_000_001, &[500_000, 300_000, 200_000], &[2, 0, 3], [9; 32], &e).unwrap();
        let entry = |i: usize| i64::from_le_bytes(out[4 + i * 40 + 32..4 + i * 40 + 40].try_into().unwrap());
        assert_eq!([entry(0), entry(1), entry(2), entry(3)], [-1_000_001, 500_001, 300_000, 200_000]);
        assert_eq!(out[4 + 40], 3); // first place is entrant 2
        assert_eq!(split(&mut out, 10, &[500_000, 500_000], &[1, 1], [9; 32], &e), Err(err::OUT_OF_BOUNDS));
        assert_eq!(split(&mut out, 10, &[500_000, 500_000], &[0, 4], [9; 32], &e), Err(err::OUT_OF_BOUNDS));
    }
}
