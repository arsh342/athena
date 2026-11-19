fn f(data: &[u8]) -> &[u8] {
    &data[..data.len().min(8)]
}
