#![allow(dead_code)]

mod diag;
mod fmt;
mod ir;
mod semantic;
mod syntax;

use serde_json::json;
use std::sync::Mutex;

static BUFFER: Mutex<Vec<u8>> = Mutex::new(Vec::new());

const FILE: &str = "app.nari";

fn respond(run: impl FnOnce(&str) -> serde_json::Value) -> usize {
    let mut buffer = BUFFER.lock().expect("buffer lock");
    let out = match std::str::from_utf8(&buffer) {
        Ok(src) => run(src),
        Err(_) => json!({ "ok": false, "diagnostics": [] }),
    };
    *buffer = out.to_string().into_bytes();
    buffer.len()
}

#[unsafe(no_mangle)]
pub extern "C" fn nari_buffer(len: usize) -> *mut u8 {
    let mut buffer = BUFFER.lock().expect("buffer lock");
    buffer.clear();
    buffer.resize(len, 0);
    buffer.as_mut_ptr()
}

#[unsafe(no_mangle)]
pub extern "C" fn nari_result() -> *const u8 {
    BUFFER.lock().expect("buffer lock").as_ptr()
}

#[unsafe(no_mangle)]
pub extern "C" fn nari_compile() -> usize {
    respond(|src| {
        let checked = syntax::parse(src, FILE)
            .map_err(|d| vec![d.locate(src)])
            .and_then(|doc| semantic::check(&doc, src));
        match checked {
            Ok((c, warnings)) => json!({
                "ok": true,
                "ir": ir::canonical(&c.ir_json()),
                "web": ir::web_config(&c.app, &c.source_sha256),
                "app": ir::to_json(&c.app),
                "diagnostics": warnings,
            }),
            Err(diagnostics) => json!({ "ok": false, "diagnostics": diagnostics }),
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn nari_format() -> usize {
    respond(|src| match syntax::parse(src, FILE) {
        Ok(doc) => json!({ "ok": true, "source": fmt::format(src, &doc) }),
        Err(d) => json!({ "ok": false, "diagnostics": [d.locate(src)] }),
    })
}
