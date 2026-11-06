//! `graded_payout`: an insurance claim paid by grade ("percent damaged"), from
//! the contract's own reserve, which persists across claims.
//!
//! Instructions:
//! * `0 claim`: percent (u64, 0 to 100), coverage (u64 base units), pot key,
//!   beneficiary key. Pays floor(coverage × percent / 100), capped at what the
//!   reserve still holds. Accounts: state (0), transfer list (1).
//! * `1 fund`: amount (u64). Adds to the reserve. Accounts: state (0).
//!
//! State (24 bytes): reserve, paid, claims (u64).
#![cfg_attr(target_os = "solana", no_std)]

use abi::{err, get_u64, put_u64, write_transfers, Input, Reader};

pub fn claim(state: &mut [u8], out: &mut [u8], percent: u64, coverage: u64, pot: [u8; 32], to: [u8; 32]) -> Result<(), u64> {
    if percent > 100 {
        return Err(err::OUT_OF_BOUNDS);
    }
    let reserve = get_u64(state, 0)?;
    let paid = get_u64(state, 1)?;
    let claims = get_u64(state, 2)?;
    let owed = ((coverage as u128) * (percent as u128) / 100) as u64;
    let pay = if owed < reserve { owed } else { reserve };
    if pay > i64::MAX as u64 {
        return Err(err::OVERFLOW);
    }
    if pay > 0 {
        write_transfers(out, &[(pot, -(pay as i64)), (to, pay as i64)])?;
    } else {
        write_transfers(out, &[])?;
    }
    put_u64(state, 0, reserve - pay)?;
    put_u64(state, 1, paid.checked_add(pay).ok_or(err::OVERFLOW)?)?;
    put_u64(state, 2, claims.checked_add(1).ok_or(err::OVERFLOW)?)
}

pub fn fund(state: &mut [u8], amount: u64) -> Result<(), u64> {
    let reserve = get_u64(state, 0)?;
    put_u64(state, 0, reserve.checked_add(amount).ok_or(err::OVERFLOW)?)
}

pub fn process(ix: &mut Input) -> Result<(), u64> {
    let mut r = Reader::new(ix.data);
    match r.u8()? {
        0 => {
            ix.expect(2)?;
            let (percent, coverage, pot, to) = (r.u64()?, r.u64()?, r.key()?, r.key()?);
            r.end()?;
            let state = ix.take_owned(0)?;
            let out = ix.take_owned(1)?;
            claim(state, out, percent, coverage, pot, to)
        }
        1 => {
            ix.expect(1)?;
            let amount = r.u64()?;
            r.end()?;
            fund(ix.take_owned(0)?, amount)
        }
        _ => Err(err::BAD_INPUT),
    }
}

abi::entrypoint!(process);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pays_by_grade_and_caps_at_the_reserve() {
        let mut st = [0u8; 24];
        let mut out = [0u8; abi::TRANSFERS_ACCOUNT];
        fund(&mut st, 1_000).unwrap();
        claim(&mut st, &mut out, 35, 2_000, [1; 32], [2; 32]).unwrap();
        assert_eq!(get_u64(&st, 0).unwrap(), 300);
        claim(&mut st, &mut out, 100, 2_000, [1; 32], [2; 32]).unwrap();
        assert_eq!([0, 1, 2].map(|i| get_u64(&st, i).unwrap()), [0, 1_000, 2]);
        assert_eq!(claim(&mut st, &mut out, 101, 2_000, [1; 32], [2; 32]), Err(err::OUT_OF_BOUNDS));
    }
}
