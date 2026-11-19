use std::fs;
use std::process::Command;

async fn handler(Query(p): Query<Params>) -> String {
    let q = format!("SELECT * FROM users WHERE id = {}", p.id);
    sqlx::query(&q).fetch_one(&pool).await; // EXPECT taint.sql-injection
    Command::new("sh").arg("-c").arg(&p.cmd).output(); // EXPECT taint.command-injection
    let data = fs::read_to_string(&p.path); // EXPECT taint.path-traversal
    Html(format!("<h1>{}</h1>", p.name)) // EXPECT taint.xss
}

fn hash_password(password: &str) -> String {
    let h = Md5::new(); // EXPECT crypto.weak-hash
    String::new()
}

fn reset_token() -> u64 {
    let reset_token = rand::random::<u64>(); // EXPECT crypto.insecure-random
    reset_token
}

fn raw(ptr: *const u8) -> u8 {
    unsafe { *ptr } // EXPECT rust.unsafe-block
}

fn client() {
    reqwest::Client::builder().danger_accept_invalid_certs(true); // EXPECT tls.verification-disabled
}
