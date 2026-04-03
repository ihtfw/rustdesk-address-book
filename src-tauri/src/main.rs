use std::env;
use std::process;

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() > 1 && args[1] == "decode" {
        run_decode(&args[2..]);
    } else {
        // GUI mode — detach from console on Windows release builds
        #[cfg(all(not(debug_assertions), windows))]
        {
            extern "system" {
                fn FreeConsole() -> i32;
            }
            unsafe { FreeConsole(); }
        }
        rustdesk_address_book_lib::run()
    }
}

fn run_decode(args: &[String]) {
    let mut file_path: Option<&str> = None;
    let mut b64_input: Option<&str> = None;
    let mut key: Option<&str> = None;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "-f" => {
                i += 1;
                file_path = args.get(i).map(|s| s.as_str());
            }
            "-b" => {
                i += 1;
                b64_input = args.get(i).map(|s| s.as_str());
            }
            "-k" => {
                i += 1;
                key = args.get(i).map(|s| s.as_str());
            }
            other => {
                eprintln!("Unknown argument: {other}");
                process::exit(1);
            }
        }
        i += 1;
    }

    let key = key.unwrap_or_else(|| {
        eprintln!("Usage: rustdesk-address-book decode (-f <file> | -b <base64>) -k <key>");
        process::exit(1);
    });

    let blob = if let Some(path) = file_path {
        std::fs::read(path).unwrap_or_else(|e| {
            eprintln!("Failed to read file: {e}");
            process::exit(1);
        })
    } else if let Some(b64) = b64_input {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD
            .decode(b64)
            .unwrap_or_else(|e| {
                eprintln!("Invalid base64: {e}");
                process::exit(1);
            })
    } else {
        eprintln!("Usage: rustdesk-address-book decode (-f <file> | -b <base64>) -k <key>");
        process::exit(1);
    };

    let plaintext = rustdesk_address_book_lib::decrypt_blob(&blob, key).unwrap_or_else(|e| {
        eprintln!("Decryption failed: {e}");
        process::exit(1);
    });

    let json: serde_json::Value = serde_json::from_slice(&plaintext).unwrap_or_else(|e| {
        eprintln!("Failed to parse JSON: {e}");
        process::exit(1);
    });

    println!("{}", serde_json::to_string_pretty(&json).unwrap());
}
