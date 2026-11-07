//! `verafy_ruling`: one Actually Smart Contract ruling, settled on Solana.
//!
//! A ruling account (owned by this program, created by the client at
//! `RULING_SIZE` bytes) moves through: empty, open, sealed or below-bar.
//! The program decides nothing about the contract. It checks that each juror
//! committed before revealing, that every reveal matches its commitment, and
//! it counts agreement against the bar the opener set. The AI ran off chain.
//!
//! Instructions (tag byte first):
//! - `0 open`   accounts [ruling (w), opener (signer)]
//!              data: contract_hash[32], bar_ppm u32, n u8, n juror keys[32]
//! - `1 commit` accounts [ruling (w), juror (signer)]
//!              data: index u8, commitment[32]
//! - `2 reveal` accounts [ruling (w), juror (signer)]
//!              data: index u8, answer u8, reasoning_hash[32], salt[32]
//!              commitment = sha256(contract_hash || index || answer || reasoning_hash || salt)
//! - `3 seal`   accounts [ruling (w), opener (signer)]
//!              data: summary_len u16, summary (at most 512 bytes)
//!              Every seated juror must have revealed. The plurality answer
//!              wins if its votes / seats >= bar; otherwise below-bar.
//!
//! Layout (little endian):
//!   0  magic "VRFYRUL1"          8  status u8   9 n u8   10 answer u8   11 agree u8
//!   12 bar_ppm u32               16 contract_hash[32]   48 opener[32]
//!   80 juror i at 80 + 104*i:   key[32] commitment[32] reasoning_hash[32] answer u8 flags u8 (pad 6)
//!   912 summary_len u16, 914 summary[512]
#![cfg_attr(target_os = "solana", no_std)]

use abi::{err, Input, Reader};

pub const MAGIC: &[u8; 8] = b"VRFYRUL1";
pub const MAX_JURORS: usize = 8;
pub const JUROR_SIZE: usize = 104;
pub const SUMMARY_MAX: usize = 512;
pub const SUMMARY_AT: usize = 80 + MAX_JURORS * JUROR_SIZE;
pub const RULING_SIZE: usize = SUMMARY_AT + 2 + SUMMARY_MAX;

pub const EMPTY: u8 = 0;
pub const OPEN: u8 = 1;
pub const SEALED: u8 = 2;
pub const BELOW_BAR: u8 = 3;

const COMMITTED: u8 = 1;
const REVEALED: u8 = 2;

/// The account is not in the state this instruction needs.
pub const WRONG_STATE: u64 = 100;
/// The signer is not the seated juror or the opener.
pub const NOT_AUTHORIZED: u64 = 101;
/// A reveal does not match its commitment.
pub const BAD_REVEAL: u64 = 102;
/// Commit twice, reveal twice, or reveal before commit.
pub const OUT_OF_ORDER: u64 = 103;
/// Seal before every seat revealed.
pub const NOT_ALL_REVEALED: u64 = 104;

fn juror_at(i: usize) -> usize {
    80 + i * JUROR_SIZE
}

fn signer_key<'a>(ix: &mut Input<'a>, i: usize) -> Result<[u8; 32], u64> {
    match ix.accounts.get_mut(i).and_then(|a| a.take()) {
        Some(a) if a.is_signer => Ok(*a.key),
        Some(_) => Err(NOT_AUTHORIZED),
        None => Err(err::BAD_ACCOUNTS),
    }
}

/// The commitment a juror makes. Off chain this is the same SHA-256.
pub fn commitment(contract: &[u8; 32], index: u8, answer: u8, reasoning: &[u8; 32], salt: &[u8; 32]) -> [u8; 32] {
    let idx = [index, answer];
    sha256(&[contract, &idx, reasoning, salt])
}

#[cfg(target_os = "solana")]
fn sha256(parts: &[&[u8]]) -> [u8; 32] {
    extern "C" {
        fn sol_sha256(vals: *const u8, val_len: u64, hash_result: *mut u8) -> u64;
    }
    let mut out = [0u8; 32];
    unsafe { sol_sha256(parts.as_ptr() as *const u8, parts.len() as u64, out.as_mut_ptr()) };
    out
}

#[cfg(not(target_os = "solana"))]
fn sha256(_parts: &[&[u8]]) -> [u8; 32] {
    // Host builds only type-check; the program is tested on a validator.
    [0u8; 32]
}

pub fn process(ix: &mut Input) -> Result<(), u64> {
    ix.expect(2)?;
    let mut r = Reader::new(ix.data);
    let tag = r.u8()?;
    let who = signer_key(ix, 1)?;
    let s = ix.take_owned(0)?;
    if s.len() < RULING_SIZE {
        return Err(err::SMALL_ACCOUNT);
    }
    match tag {
        0 => {
            let contract = r.bytes(32)?;
            let bar = r.u32()?;
            let n = r.u8()? as usize;
            if n == 0 || n > MAX_JURORS || bar == 0 || bar > 1_000_000 {
                return Err(err::OUT_OF_BOUNDS);
            }
            if s[8] != EMPTY || s[0..8].iter().any(|b| *b != 0) {
                return Err(WRONG_STATE);
            }
            for i in 0..n {
                let k = r.bytes(32)?;
                for j in 0..i {
                    if &s[juror_at(j)..juror_at(j) + 32] == k {
                        return Err(err::BAD_ACCOUNTS);
                    }
                }
                s[juror_at(i)..juror_at(i) + 32].copy_from_slice(k);
            }
            r.end()?;
            s[0..8].copy_from_slice(MAGIC);
            s[8] = OPEN;
            s[9] = n as u8;
            s[12..16].copy_from_slice(&bar.to_le_bytes());
            s[16..48].copy_from_slice(contract);
            s[48..80].copy_from_slice(&who);
            abi::log("verafy_ruling: open");
            Ok(())
        }
        1 | 2 => {
            if s[8] != OPEN {
                return Err(WRONG_STATE);
            }
            let i = r.u8()? as usize;
            if i >= s[9] as usize {
                return Err(err::OUT_OF_BOUNDS);
            }
            let at = juror_at(i);
            if s[at..at + 32] != who {
                return Err(NOT_AUTHORIZED);
            }
            let flags = at + 97;
            if tag == 1 {
                let c = r.bytes(32)?;
                r.end()?;
                if s[flags] != 0 {
                    return Err(OUT_OF_ORDER);
                }
                s[at + 32..at + 64].copy_from_slice(c);
                s[flags] = COMMITTED;
                abi::log("verafy_ruling: commit");
            } else {
                let answer = r.u8()?;
                let reasoning = r.key()?;
                let salt = r.key()?;
                r.end()?;
                if s[flags] != COMMITTED {
                    return Err(OUT_OF_ORDER);
                }
                let mut contract = [0u8; 32];
                contract.copy_from_slice(&s[16..48]);
                let c = commitment(&contract, i as u8, answer, &reasoning, &salt);
                if s[at + 32..at + 64] != c {
                    return Err(BAD_REVEAL);
                }
                s[at + 64..at + 96].copy_from_slice(&reasoning);
                s[at + 96] = answer;
                s[flags] = REVEALED;
                abi::log("verafy_ruling: reveal");
            }
            Ok(())
        }
        3 => {
            if s[8] != OPEN {
                return Err(WRONG_STATE);
            }
            if s[48..80] != who {
                return Err(NOT_AUTHORIZED);
            }
            let len = {
                let b = r.bytes(2)?;
                u16::from_le_bytes([b[0], b[1]]) as usize
            };
            if len > SUMMARY_MAX {
                return Err(err::OUT_OF_BOUNDS);
            }
            let summary = r.bytes(len)?;
            r.end()?;
            let n = s[9] as usize;
            let mut counts = [0u8; 256];
            for i in 0..n {
                let at = juror_at(i);
                if s[at + 97] != REVEALED {
                    return Err(NOT_ALL_REVEALED);
                }
                let a = s[at + 96] as usize;
                counts[a] = counts[a].checked_add(1).ok_or(err::OVERFLOW)?;
            }
            // Plurality; a tie goes to the lower answer index, and a tie at the
            // top can only reach the bar if the bar is at most one half.
            let mut best = 0usize;
            for a in 1..256 {
                if counts[a] > counts[best] {
                    best = a;
                }
            }
            let bar = u32::from_le_bytes([s[12], s[13], s[14], s[15]]) as u64;
            let agree = counts[best] as u64;
            let met = agree * 1_000_000 >= bar * n as u64;
            s[8] = if met { SEALED } else { BELOW_BAR };
            s[10] = best as u8;
            s[11] = agree as u8;
            s[SUMMARY_AT..SUMMARY_AT + 2].copy_from_slice(&(len as u16).to_le_bytes());
            s[SUMMARY_AT + 2..SUMMARY_AT + 2 + len].copy_from_slice(summary);
            for b in s[SUMMARY_AT + 2 + len..RULING_SIZE].iter_mut() {
                *b = 0;
            }
            abi::log(if met { "verafy_ruling: sealed" } else { "verafy_ruling: below bar" });
            Ok(())
        }
        _ => Err(err::BAD_INPUT),
    }
}

abi::entrypoint!(process);
