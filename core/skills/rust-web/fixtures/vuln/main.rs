use tower_http::cors::CorsLayer;
fn app() {
    let layer = CorsLayer::permissive(); // EXPECT rust-web.permissive-cors
}
