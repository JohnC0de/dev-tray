//! Listening TCP ports in [1024, 49152) via GetExtendedTcpTable.

use std::collections::{HashMap, HashSet};

use windows::Win32::Foundation::{ERROR_INSUFFICIENT_BUFFER, NO_ERROR};
use windows::Win32::NetworkManagement::IpHelper::{
    GetExtendedTcpTable, MIB_TCP_STATE_LISTEN, MIB_TCPTABLE_OWNER_PID, MIB_TCPROW_OWNER_PID,
    TCP_TABLE_OWNER_PID_ALL,
};
use windows::Win32::Networking::WinSock::AF_INET;

pub const PORT_MIN: u16 = 1024;
pub const PORT_MAX_EXCLUSIVE: u16 = 49152;

pub fn listening_ports_by_pid() -> Result<HashMap<u32, HashSet<u16>>, String> {
    let rows = fetch_tcp_rows()?;
    let mut by_pid: HashMap<u32, HashSet<u16>> = HashMap::new();
    for row in rows {
        if row.dwState != MIB_TCP_STATE_LISTEN.0 as u32 {
            continue;
        }
        let port = tcp_local_port(row.dwLocalPort);
        if !port_in_scan_range(port) {
            continue;
        }
        let pid = row.dwOwningPid;
        if pid == 0 {
            continue;
        }
        by_pid.entry(pid).or_default().insert(port);
    }
    Ok(by_pid)
}

pub fn port_in_scan_range(port: u16) -> bool {
    port >= PORT_MIN && port < PORT_MAX_EXCLUSIVE
}

/// `dwLocalPort` is stored in network byte order (see MSDN / `ntohs` on the low 16 bits).
pub fn tcp_local_port(dw: u32) -> u16 {
    let p = (dw & 0xffff) as u16;
    (p >> 8) | (p << 8)
}

fn fetch_tcp_rows() -> Result<Vec<MIB_TCPROW_OWNER_PID>, String> {
    unsafe {
        let mut size = 0u32;
        let af = u32::from(AF_INET.0);
        let mut ret = GetExtendedTcpTable(
            None,
            &mut size,
            false,
            af,
            TCP_TABLE_OWNER_PID_ALL,
            0,
        );
        if ret != ERROR_INSUFFICIENT_BUFFER.0 && ret != NO_ERROR.0 {
            return Err(format!("GetExtendedTcpTable size query failed: {ret}"));
        }
        let mut buf = vec![0u8; size as usize];
        ret = GetExtendedTcpTable(
            Some(buf.as_mut_ptr() as *mut _),
            &mut size,
            false,
            af,
            TCP_TABLE_OWNER_PID_ALL,
            0,
        );
        if ret != NO_ERROR.0 {
            return Err(format!("GetExtendedTcpTable failed: {ret}"));
        }
        if buf.len() < std::mem::size_of::<MIB_TCPTABLE_OWNER_PID>() {
            return Ok(vec![]);
        }
        let table = &*(buf.as_ptr() as *const MIB_TCPTABLE_OWNER_PID);
        let count = table.dwNumEntries as usize;
        let base = table.table.as_ptr();
        Ok(std::slice::from_raw_parts(base, count).to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::{port_in_scan_range, tcp_local_port, PORT_MAX_EXCLUSIVE, PORT_MIN};

    #[test]
    fn port_range_matches_worker() {
        assert!(port_in_scan_range(PORT_MIN));
        assert!(port_in_scan_range(PORT_MAX_EXCLUSIVE - 1));
        assert!(!port_in_scan_range(PORT_MIN - 1));
        assert!(!port_in_scan_range(PORT_MAX_EXCLUSIVE));
    }

    #[test]
    fn decodes_network_order_port() {
        assert_eq!(tcp_local_port(0x0000_3514), 5173);
        assert_eq!(tcp_local_port(0x0000_5000), 80);
    }
}
