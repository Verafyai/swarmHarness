//! `bond`: lock, release and slash a harness bond. There is no instruction that
//! spends a bond on bills: the only ways out are release (back to the harness)
//! and slash (to whoever the fault rules name), and neither can exceed what is
//! locked.
//!
//! Instructions (tag byte, then a u64 amount in base units):
//! `0 lock`, `1 release`, `2 slash`. Any other tag is refused.
//!
//! Bond state (account 0, 32 bytes): deposited, locked, slashed, released (u64).
//! After every instruction, deposited == locked + slashed + released.
#![cfg_attr(target_os = "solana", no_std)]

use abi::{err, get_u64, put_u64, Input, Reader};

/// A slash larger than the locked bond.
pub const SLASH_EXCEEDS_BOND: u64 = 100;
/// A release larger than the locked bond.
pub const RELEASE_EXCEEDS_BOND: u64 = 101;

pub const LOCK: u8 = 0;
pub const RELEASE: u8 = 1;
pub const SLASH: u8 = 2;

pub fn apply(state: &mut [u8], op: u8, amount: u64) -> Result<(), u64> {
    if state.len() < 32 {
        return Err(err::SMALL_ACCOUNT);
    }
    let (mut dep, mut locked, mut slashed, mut released) = (get_u64(state, 0)?, get_u64(state, 1)?, get_u64(state, 2)?, get_u64(state, 3)?);
    match op {
        LOCK => {
            dep = dep.checked_add(amount).ok_or(err::OVERFLOW)?;
            locked = locked.checked_add(amount).ok_or(err::OVERFLOW)?;
        }
        RELEASE => {
            if amount > locked {
                return Err(RELEASE_EXCEEDS_BOND);
            }
            locked -= amount;
            released = released.checked_add(amount).ok_or(err::OVERFLOW)?;
        }
        SLASH => {
            if amount > locked {
                return Err(SLASH_EXCEEDS_BOND);
            }
            locked -= amount;
            slashed = slashed.checked_add(amount).ok_or(err::OVERFLOW)?;
        }
        _ => return Err(err::BAD_INPUT),
    }
    let out = (locked as u128) + (slashed as u128) + (released as u128);
    if out != dep as u128 {
        return Err(err::NOT_CONSERVED);
    }
    put_u64(state, 0, dep)?;
    put_u64(state, 1, locked)?;
    put_u64(state, 2, slashed)?;
    put_u64(state, 3, released)
}

pub fn process(ix: &mut Input) -> Result<(), u64> {
    ix.expect(1)?;
    let mut r = Reader::new(ix.data);
    let op = r.u8()?;
    let amount = r.u64()?;
    r.end()?;
    apply(ix.take_owned(0)?, op, amount)
}

abi::entrypoint!(process);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_slash_can_never_exceed_the_bond() {
        let mut st = [0u8; 32];
        apply(&mut st, LOCK, 250).unwrap();
        assert_eq!(apply(&mut st, SLASH, 251), Err(SLASH_EXCEEDS_BOND));
        apply(&mut st, SLASH, 200).unwrap();
        assert_eq!(apply(&mut st, SLASH, 51), Err(SLASH_EXCEEDS_BOND));
        apply(&mut st, RELEASE, 50).unwrap();
        assert_eq!([0, 1, 2, 3].map(|i| get_u64(&st, i).unwrap()), [250, 0, 200, 50]);
    }

    #[test]
    fn there_is_no_spend() {
        let mut st = [0u8; 32];
        apply(&mut st, LOCK, 10).unwrap();
        for op in 3..=255u8 {
            assert_eq!(apply(&mut st, op, 1), Err(err::BAD_INPUT));
        }
    }
}
