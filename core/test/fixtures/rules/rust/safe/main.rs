use std::process::Command;

async fn handler(Query(p): Query<Params>) -> String {
    sqlx::query("SELECT * FROM users WHERE id = $1").bind(p.id).fetch_one(&pool).await;
    Command::new("ping").arg("-c").arg("1").arg(&p.host).output();
    let n: i64 = p.n.parse().unwrap_or(0);
    let q = format!("SELECT * FROM t WHERE n = {}", n);
    sqlx::query("SELECT 1");
    format!("{}", html_escape::encode_text(&p.name))
}

fn checksum(data: &[u8]) -> Vec<u8> {
    let h = Md5::new();
    Vec::new()
}

fn token() -> [u8; 32] {
    let mut b = [0u8; 32];
    getrandom::getrandom(&mut b).unwrap();
    b
}
