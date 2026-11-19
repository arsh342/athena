using Microsoft.AspNetCore.Builder;
class S {
  void C(CorsPolicyBuilder b) {
    b.WithOrigins("https://app.example.org").AllowCredentials();
  }
  void O(CookieBuilder c) {
    c.SecurePolicy = CookieSecurePolicy.Always;
  }
}
