#![cfg_attr(not(windows), allow(dead_code))]

mod peb_cwd;
mod process_meta;
mod tcp_listen;

use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi(object)]
pub struct ScanRow {
    pub port: u32,
    pub pid: u32,
    pub name: Option<String>,
    pub path: Option<String>,
    pub cmd: Option<String>,
    pub cwd: Option<String>,
    pub start: Option<String>,
}

#[napi]
pub fn scan_listening_ports() -> Result<Vec<ScanRow>> {
    scan_listening_ports_impl().map_err(|e| Error::from_reason(e))
}

fn scan_listening_ports_impl() -> std::result::Result<Vec<ScanRow>, String> {
    #[cfg(windows)]
    {
        return windows_scan::scan();
    }
    #[cfg(not(windows))]
    {
        Err("scan-native is only supported on Windows".to_string())
    }
}

#[cfg(windows)]
mod windows_scan {
    use std::collections::HashMap;

    use crate::peb_cwd::get_process_cwd;
    use crate::process_meta::{get_process_meta, ProcMeta};
    use crate::tcp_listen::listening_ports_by_pid;
    use crate::ScanRow;

    pub fn scan() -> Result<Vec<ScanRow>, String> {
        let by_pid = listening_ports_by_pid()?;
        if by_pid.is_empty() {
            return Ok(vec![]);
        }

        let mut meta_cache: HashMap<u32, ProcMeta> = HashMap::new();
        let mut out = Vec::new();

        for (pid, ports) in by_pid {
            let meta = meta_cache
                .entry(pid)
                .or_insert_with(|| get_process_meta(pid));
            let cwd = get_process_cwd(pid);
            for port in ports {
                out.push(ScanRow {
                    port: port as u32,
                    pid,
                    name: meta.name.clone(),
                    path: meta.path.clone(),
                    cmd: meta.cmd.clone(),
                    cwd: cwd.clone(),
                    start: meta.start.clone(),
                });
            }
        }

        out.sort_by(|a, b| a.port.cmp(&b.port).then(a.pid.cmp(&b.pid)));
        Ok(out)
    }
}
