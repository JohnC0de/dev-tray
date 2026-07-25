//! Process name, image path, command line, and creation time for a PID.

use std::ffi::c_void;
use std::path::Path;

use chrono::{DateTime, SecondsFormat, Utc};
use windows::Win32::Foundation::{CloseHandle, FILETIME, HANDLE};
use windows::Win32::System::Threading::{
    GetProcessTimes, OpenProcess, QueryFullProcessImageNameW, PROCESS_ACCESS_RIGHTS,
    PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ,
};

fn process_access() -> PROCESS_ACCESS_RIGHTS {
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

const PROCESS_COMMAND_LINE_INFORMATION: u32 = 60;

#[repr(C)]
struct UnicodeString {
    length: u16,
    maximum_length: u16,
    buffer: *mut u16,
}

pub struct ProcMeta {
    pub name: Option<String>,
    pub path: Option<String>,
    pub cmd: Option<String>,
    pub start: Option<String>,
}

pub fn get_process_meta(pid: u32) -> ProcMeta {
    if pid == 0 {
        return ProcMeta::empty();
    }
    let Some(handle) = open_process(pid) else {
        return ProcMeta::empty();
    };
    let meta = read_meta(handle);
    unsafe {
        let _ = CloseHandle(handle);
    }
    meta
}

impl ProcMeta {
    fn empty() -> Self {
        Self {
            name: None,
            path: None,
            cmd: None,
            start: None,
        }
    }
}

fn open_process(pid: u32) -> Option<HANDLE> {
    unsafe { OpenProcess(process_access(), false, pid).ok() }
}

fn read_meta(handle: HANDLE) -> ProcMeta {
    let path = query_image_path(handle);
    let name = path
        .as_ref()
        .and_then(|p| Path::new(p).file_name().map(|s| s.to_string_lossy().into_owned()));
    let cmd = query_command_line(handle).or_else(|| read_cmd_from_peb(handle));
    let start = query_start_iso(handle);
    ProcMeta {
        name,
        path,
        cmd,
        start,
    }
}

fn query_image_path(handle: HANDLE) -> Option<String> {
    let mut buf = vec![0u16; 32_768];
    let mut len = buf.len() as u32;
    unsafe {
        QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_FORMAT(0),
            windows::core::PWSTR(buf.as_mut_ptr()),
            &mut len,
        )
        .ok()?;
    }
    let s = String::from_utf16_lossy(&buf[..len as usize]);
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

fn query_command_line(handle: HANDLE) -> Option<String> {
    unsafe {
        let mut us = UnicodeString {
            length: 0,
            maximum_length: 0,
            buffer: std::ptr::null_mut(),
        };
        let mut ret_len = 0u32;
        if NtQueryInformationProcess(
            handle,
            PROCESS_COMMAND_LINE_INFORMATION,
            &mut us as *mut _ as *mut c_void,
            std::mem::size_of::<UnicodeString>() as u32,
            &mut ret_len,
        ) != 0
        {
            return None;
        }
        read_unicode_string_from_process(handle, &us)
    }
}

/// Fallback: RTL_USER_PROCESS_PARAMETERS.CommandLine on x64 Windows 10+.
fn read_cmd_from_peb(handle: HANDLE) -> Option<String> {
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

    unsafe {
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
        let us = read_bytes(handle, proc_params.add(0x70), 16)?;
        let length = u16::from_le_bytes([us[0], us[1]]) as usize;
        let buffer = read_ptr_from_bytes(&us[8..16])?;
        if length == 0 || buffer.is_null() || length > 0x7fff0 {
            return None;
        }
        let str_bytes = read_bytes(handle, buffer, length)?;
        let wide: Vec<u16> = str_bytes
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        let s = String::from_utf16_lossy(&wide).trim_end_matches('\0').to_string();
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    }
}

fn read_unicode_string_from_process(handle: HANDLE, us: &UnicodeString) -> Option<String> {
    use windows::Win32::System::Diagnostics::Debug::ReadProcessMemory;

    unsafe {
        let len = us.length as usize;
        if len == 0 || us.buffer.is_null() || len > 0x7fff0 {
            return None;
        }
        let mut buf = vec![0u8; len];
        let mut read = 0usize;
        ReadProcessMemory(
            handle,
            us.buffer as *const _,
            buf.as_mut_ptr() as *mut _,
            len,
            Some(&mut read),
        )
        .ok()?;
        if read != len {
            return None;
        }
        let wide: Vec<u16> = buf
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        let s = String::from_utf16_lossy(&wide).trim_end_matches('\0').to_string();
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    }
}

fn query_start_iso(handle: HANDLE) -> Option<String> {
    unsafe {
        let mut created = FILETIME::default();
        let mut exit = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        GetProcessTimes(handle, &mut created, &mut exit, &mut kernel, &mut user).ok()?;
        filetime_to_utc_iso(&created)
    }
}

fn filetime_to_utc_iso(ft: &FILETIME) -> Option<String> {
    let time: u64 = ((ft.dwHighDateTime as u64) << 32) | ft.dwLowDateTime as u64;
    if time == 0 {
        return None;
    }
    const EPOCH_DIFF: u64 = 116_444_736_000_000_000;
    const TICKS_PER_SEC: u64 = 10_000_000;
    let ticks = time.saturating_sub(EPOCH_DIFF);
    let secs = (ticks / TICKS_PER_SEC) as i64;
    let nanos = ((ticks % TICKS_PER_SEC) * 100) as u32;
    DateTime::<Utc>::from_timestamp(secs, nanos)
        .map(|dt| dt.to_rfc3339_opts(SecondsFormat::Millis, true))
}

unsafe fn read_ptr(handle: HANDLE, addr: *const c_void) -> Option<*const c_void> {
    let b = read_bytes(handle, addr, 8)?;
    read_ptr_from_bytes(&b)
}

unsafe fn read_ptr_from_bytes(b: &[u8]) -> Option<*const c_void> {
    let v = i64::from_le_bytes(b[0..8].try_into().ok()?);
    if v == 0 {
        None
    } else {
        Some(v as *const c_void)
    }
}

unsafe fn read_bytes(handle: HANDLE, addr: *const c_void, size: usize) -> Option<Vec<u8>> {
    use windows::Win32::System::Diagnostics::Debug::ReadProcessMemory;

    let mut buf = vec![0u8; size];
    let mut read = 0usize;
    ReadProcessMemory(handle, addr, buf.as_mut_ptr() as *mut _, size, Some(&mut read)).ok()?;
    if read != size {
        return None;
    }
    Some(buf)
}
