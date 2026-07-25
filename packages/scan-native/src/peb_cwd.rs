//! Current working directory via the target process PEB (64-bit, same-user).
//! Logic ported from `scan-worker.ps1` (offsets and path validation).

use std::ffi::c_void;

use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::Diagnostics::Debug::ReadProcessMemory;
use windows::Win32::System::Threading::{
    IsWow64Process, OpenProcess, PROCESS_ACCESS_RIGHTS, PROCESS_QUERY_INFORMATION,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ,
};

fn process_access() -> PROCESS_ACCESS_RIGHTS {
    PROCESS_QUERY_INFORMATION | PROCESS_VM_READ
}

fn process_access_limited() -> PROCESS_ACCESS_RIGHTS {
    PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ
}

#[link(name = "ntdll")]
extern "system" {
    fn NtQueryInformationProcess(
        process_handle: HANDLE,
        process_information_class: u32,
        process_information: *mut c_void,
        process_information_length: u32,
        return_length: *mut u32,
    ) -> i32;
}

#[repr(C)]
struct ProcessBasicInformation {
    exit_status: i32,
    reserved: i32,
    peb_base_address: *mut c_void,
    affinity_mask: usize,
    base_priority: i32,
    unique_process_id: usize,
    inherited_from_unique_process_id: usize,
}

pub fn get_process_cwd(pid: u32) -> Option<String> {
    if pid == 0 {
        return None;
    }
    let handle = open_process(pid)?;
    let cwd = read_cwd_from_handle(handle);
    unsafe {
        let _ = CloseHandle(handle);
    }
    cwd
}

fn open_process(pid: u32) -> Option<HANDLE> {
    unsafe {
        let h = OpenProcess(process_access(), false, pid);
        if h.is_ok() {
            return h.ok();
        }
        OpenProcess(process_access_limited(), false, pid).ok()
    }
}

fn read_cwd_from_handle(handle: HANDLE) -> Option<String> {
    unsafe {
        let mut wow64 = false.into();
        if IsWow64Process(handle, &mut wow64).is_ok() && wow64.as_bool() {
            // 32-bit target uses different PEB layout
            return None;
        }

        let mut pbi = ProcessBasicInformation {
            exit_status: 0,
            reserved: 0,
            peb_base_address: std::ptr::null_mut(),
            affinity_mask: 0,
            base_priority: 0,
            unique_process_id: 0,
            inherited_from_unique_process_id: 0,
        };
        let mut ret_len = 0u32;
        if NtQueryInformationProcess(
            handle,
            0,
            &mut pbi as *mut _ as *mut c_void,
            std::mem::size_of::<ProcessBasicInformation>() as u32,
            &mut ret_len,
        ) != 0
        {
            return None;
        }
        let peb = pbi.peb_base_address;
        if peb.is_null() {
            return None;
        }

        let proc_params = read_ptr(handle, peb.add(0x20))?;
        if proc_params.is_null() {
            return None;
        }

        let us = read_bytes(handle, proc_params.add(0x38), 16)?;
        let length = u16::from_le_bytes([us[0], us[1]]) as usize;
        let buffer = read_ptr_from_bytes(&us[8..16])?;
        if length == 0 || buffer.is_null() {
            return None;
        }
        let mut len = length;
        if len > 0x7ffe {
            return None;
        }
        if len & 1 != 0 {
            len -= 1;
        }
        if len == 0 {
            return None;
        }

        let str_bytes = read_bytes(handle, buffer, len)?;
        let wide: Vec<u16> = str_bytes
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        let mut s = String::from_utf16_lossy(&wide);
        while s.ends_with('\0') || s.ends_with('\\') || s.ends_with('/') {
            s.pop();
        }
        validate_rooted_path(&s).then_some(s)
    }
}

fn read_ptr(handle: HANDLE, addr: *const c_void) -> Option<*const c_void> {
    let b = read_bytes(handle, addr, 8)?;
    Some(read_ptr_from_bytes(&b)?)
}

fn read_ptr_from_bytes(b: &[u8]) -> Option<*const c_void> {
    if b.len() < 8 {
        return None;
    }
    let v = i64::from_le_bytes(b[0..8].try_into().ok()?);
    if v == 0 {
        None
    } else {
        Some(v as *const c_void)
    }
}

fn read_bytes(handle: HANDLE, addr: *const c_void, size: usize) -> Option<Vec<u8>> {
    unsafe {
        let mut buf = vec![0u8; size];
        let mut read = 0usize;
        ReadProcessMemory(handle, addr, buf.as_mut_ptr() as *mut _, size, Some(&mut read))
            .ok()?;
        if read != size {
            return None;
        }
        Some(buf)
    }
}

/// Only accept a rooted path (drive-letter or UNC) so torn reads cannot feed garbage.
pub fn validate_rooted_path(s: &str) -> bool {
    let bytes = s.as_bytes();
    if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
    {
        return true;
    }
    bytes.len() >= 2 && bytes[0] == b'\\' && bytes[1] == b'\\'
}

#[cfg(test)]
mod tests {
    use super::validate_rooted_path;

    #[test]
    fn accepts_drive_letter_path() {
        assert!(validate_rooted_path(r"C:\Users\dev\my-app"));
    }

    #[test]
    fn accepts_unc_path() {
        assert!(validate_rooted_path(r"\\server\share\proj"));
    }

    #[test]
    fn rejects_relative_path() {
        assert!(!validate_rooted_path("relative/path"));
    }
}
