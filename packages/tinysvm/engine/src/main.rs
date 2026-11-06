//! TinySVM engine: LiteSVM wrapped as a settlement engine, run as a sidecar.
//!
//! It reads one JSON request per line on stdin and writes one JSON reply per
//! line on stdout. Each `run` executes one transaction against a fresh copy of
//! the base VM, so the engine holds no state between requests: the caller
//! passes every account in and gets every account back.
//!
//! Restrictions (TinySVM trims by restricting, never by deleting code):
//!
//! * Programs: only the ones in `programs.lock.json`, each checked against its
//!   SHA-256 before it loads. Built-ins (escrow, bond, ledger) may always run;
//!   an exit program runs only when the request's `allow` list names its hash,
//!   which is the hash the contract declared. A program's address is its hash.
//! * Cross-program calls: any inner instruction to a program outside the
//!   request's allowlist fails the request. The TinySVM programs make none.
//! * Compute: a cap per request (`computeCap`, default 200,000 units, at most
//!   1,400,000).
//! * No SPL programs, no signature checks, no blockhash checks. The engine's
//!   own payer covers LiteSVM's signature fee and every account is funded to
//!   rent exemption: lamports are engine bookkeeping only. Token balances live
//!   in account data and never in lamports, so neither fees nor rent can touch
//!   a settlement.
//!
//! Requests:
//!
//! ```text
//! {"id":1,"op":"hello"}
//! {"id":2,"op":"run","allow":["<sha256>"],"computeCap":200000,
//!  "accounts":[{"name":"out","owner":"<sha256>","data":"<hex>"}],
//!  "instructions":[{"program":"<sha256>","accounts":[{"name":"out","writable":true}],"data":"<hex>"}]}
//! ```
use litesvm::LiteSVM;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use solana_account::Account;
use solana_address::Address;
use solana_compute_budget::compute_budget::ComputeBudget;
use solana_instruction::{account_meta::AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::collections::{BTreeMap, BTreeSet};
use std::io::{BufRead, Write};
use std::path::PathBuf;

const BUILTINS: [&str; 3] = ["escrow", "bond", "ledger"];
const DEFAULT_CAP: u64 = 200_000;
const MAX_CAP: u64 = 1_400_000;
const SYSTEM_PROGRAM: Address = Address::new_from_array([0u8; 32]);

struct Program {
    name: String,
    hash: String,
    builtin: bool,
}

struct Engine {
    base: LiteSVM,
    programs: Vec<Program>,
    payer: Keypair,
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().into()
}

fn account_address(name: &str) -> Address {
    Address::new_from_array(sha256(format!("tinysvm:account:{name}").as_bytes()))
}

fn hash_address(hex_hash: &str) -> Result<Address, String> {
    let b = hex::decode(hex_hash).map_err(|_| format!("{hex_hash} is not a hex hash"))?;
    let a: [u8; 32] = b.try_into().map_err(|_| format!("{hex_hash} is not 32 bytes"))?;
    Ok(Address::new_from_array(a))
}

impl Engine {
    fn load(dir: &PathBuf, lock: &PathBuf) -> Result<Engine, String> {
        let lock: Value = serde_json::from_str(&std::fs::read_to_string(lock).map_err(|e| format!("cannot read {}: {e}", lock.display()))?)
            .map_err(|e| format!("programs.lock.json: {e}"))?;
        let entries = lock["programs"].as_object().ok_or("programs.lock.json has no programs")?;
        let mut svm = LiteSVM::default()
            .with_feature_set(LiteSVM::mainnet_feature_set())
            .with_builtins()
            .with_sysvars()
            .with_sigverify(false)
            .with_blockhash_check(false);
        let mut programs = Vec::new();
        for (name, meta) in entries {
            let want = meta["sha256"].as_str().ok_or(format!("{name} has no sha256"))?;
            let path = dir.join(format!("{name}.so"));
            let bytes = std::fs::read(&path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
            let got = hex::encode(sha256(&bytes));
            if got != want {
                return Err(format!("{name}.so hashes to {got}, but programs.lock.json pins {want}; rebuild with scripts/build.sh"));
            }
            svm.add_program(hash_address(want)?, &bytes).map_err(|e| format!("cannot load {name}: {e:?}"))?;
            programs.push(Program { name: name.clone(), hash: got, builtin: BUILTINS.contains(&name.as_str()) });
        }
        for b in BUILTINS {
            if !programs.iter().any(|p| p.name == b) {
                return Err(format!("built-in program {b} is missing from programs.lock.json"));
            }
        }
        let payer = Keypair::new();
        svm.set_account(payer.pubkey(), Account { lamports: 1_000_000_000_000, data: vec![], owner: SYSTEM_PROGRAM, executable: false, rent_epoch: 0 })
            .map_err(|e| format!("cannot fund the engine payer: {e:?}"))?;
        Ok(Engine { base: svm, programs, payer })
    }

    fn hello(&self) -> Value {
        let programs: BTreeMap<_, _> = self.programs.iter().map(|p| (p.name.clone(), json!({ "sha256": p.hash, "builtin": p.builtin }))).collect();
        json!({ "ok": true, "engine": "tinysvm", "litesvm": "0.18.2", "transport": "sidecar", "programs": programs })
    }

    fn run(&self, req: &Value) -> Result<Value, String> {
        let mut allowed: BTreeSet<String> = self.programs.iter().filter(|p| p.builtin).map(|p| p.hash.clone()).collect();
        for h in req["allow"].as_array().into_iter().flatten() {
            let h = h.as_str().ok_or("allow entries are program hashes")?;
            if !self.programs.iter().any(|p| p.hash == h) {
                return Err(format!("program {h} is not installed"));
            }
            allowed.insert(h.to_string());
        }
        let cap = req["computeCap"].as_u64().unwrap_or(DEFAULT_CAP);
        if cap == 0 || cap > MAX_CAP {
            return Err(format!("computeCap must be between 1 and {MAX_CAP}"));
        }
        let mut svm = self.base.clone().with_compute_budget(ComputeBudget { compute_unit_limit: cap, ..ComputeBudget::new_with_defaults(false) });

        let mut names: BTreeMap<String, Address> = BTreeMap::new();
        for a in req["accounts"].as_array().ok_or("accounts must be a list")? {
            let name = a["name"].as_str().ok_or("every account needs a name")?;
            let owner = match a["owner"].as_str() {
                None | Some("system") => SYSTEM_PROGRAM,
                Some(h) if allowed.contains(h) => hash_address(h)?,
                Some(h) => return Err(format!("account {name} is owned by {h}, which is not on the allowlist")),
            };
            let data = hex::decode(a["data"].as_str().unwrap_or("")).map_err(|_| format!("account {name} data is not hex"))?;
            let lamports = svm.minimum_balance_for_rent_exemption(data.len()).max(1);
            let addr = account_address(name);
            svm.set_account(addr, Account { lamports, data, owner, executable: false, rent_epoch: 0 })
                .map_err(|e| format!("cannot set account {name}: {e:?}"))?;
            if names.insert(name.to_string(), addr).is_some() {
                return Err(format!("account {name} is declared twice"));
            }
        }

        let mut ixs = Vec::new();
        for ix in req["instructions"].as_array().ok_or("instructions must be a list")? {
            let program = ix["program"].as_str().ok_or("every instruction names a program hash")?;
            if !allowed.contains(program) {
                return Err(format!("program {program} is not on the allowlist for this request"));
            }
            let mut metas = Vec::new();
            for a in ix["accounts"].as_array().ok_or("instruction accounts must be a list")? {
                let name = a["name"].as_str().ok_or("instruction accounts need a name")?;
                let addr = *names.get(name).ok_or(format!("instruction uses undeclared account {name}"))?;
                metas.push(if a["writable"].as_bool().unwrap_or(false) { AccountMeta::new(addr, false) } else { AccountMeta::new_readonly(addr, false) });
            }
            let data = hex::decode(ix["data"].as_str().unwrap_or("")).map_err(|_| "instruction data is not hex".to_string())?;
            ixs.push(Instruction { program_id: hash_address(program)?, accounts: metas, data });
        }
        if ixs.is_empty() {
            return Err("a run needs at least one instruction".into());
        }

        let msg = Message::new(&ixs, Some(&self.payer.pubkey()));
        let keys = msg.account_keys.clone();
        let tx = Transaction::new(&[&self.payer], msg, svm.latest_blockhash());
        match svm.simulate_transaction(tx) {
            Ok(info) => {
                for (i, inner) in info.meta.inner_instructions.iter().enumerate() {
                    for c in inner {
                        let target = keys.get(c.instruction.program_id_index as usize).map(|k| hex::encode(k.to_bytes())).unwrap_or_default();
                        if !allowed.contains(&target) {
                            return Ok(json!({ "ok": false, "error": { "instruction": i, "message": format!("cross-program call to {target} is not on the allowlist") }, "logs": info.meta.logs, "computeUnits": info.meta.compute_units_consumed }));
                        }
                    }
                }
                let post: BTreeMap<Address, Vec<u8>> = info.post_accounts.into_iter().map(|(k, a)| (k, solana_account::ReadableAccount::data(&a).to_vec())).collect();
                let mut out = serde_json::Map::new();
                for (name, addr) in &names {
                    let data = match post.get(addr) {
                        Some(d) => d.clone(),
                        None => svm.get_account(addr).map(|a| a.data).unwrap_or_default(),
                    };
                    out.insert(name.clone(), Value::String(hex::encode(data)));
                }
                Ok(json!({ "ok": true, "accounts": out, "logs": info.meta.logs, "computeUnits": info.meta.compute_units_consumed }))
            }
            Err(failed) => {
                let err = match &failed.err {
                    solana_transaction::TransactionError::InstructionError(i, solana_instruction::error::InstructionError::Custom(code)) => json!({ "instruction": i, "custom": code }),
                    solana_transaction::TransactionError::InstructionError(i, e) => json!({ "instruction": i, "message": format!("{e:?}") }),
                    e => json!({ "message": format!("{e:?}") }),
                };
                Ok(json!({ "ok": false, "error": err, "logs": failed.meta.logs, "computeUnits": failed.meta.compute_units_consumed }))
            }
        }
    }
}

fn main() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let dir = std::env::var("TINYSVM_PROGRAMS").map(PathBuf::from).unwrap_or_else(|_| root.join("programs/target/deploy"));
    let lock = std::env::var("TINYSVM_LOCK").map(PathBuf::from).unwrap_or_else(|_| root.join("programs.lock.json"));
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    let engine = match Engine::load(&dir, &lock) {
        Ok(e) => e,
        Err(e) => {
            let _ = writeln!(out, "{}", json!({ "id": 0, "ok": false, "fatal": true, "error": { "message": e } }));
            std::process::exit(2);
        }
    };
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Err(e) => json!({ "ok": false, "error": { "message": format!("bad request: {e}") } }),
            Ok(req) => {
                let mut r = match req["op"].as_str() {
                    Some("hello") => engine.hello(),
                    Some("run") => engine.run(&req).unwrap_or_else(|e| json!({ "ok": false, "refused": true, "error": { "message": e } })),
                    _ => json!({ "ok": false, "error": { "message": "op must be hello or run" } }),
                };
                r["id"] = req["id"].clone();
                r
            }
        };
        if writeln!(out, "{reply}").and_then(|_| out.flush()).is_err() {
            break;
        }
    }
}
