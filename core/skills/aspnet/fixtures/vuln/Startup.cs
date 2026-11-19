using Microsoft.AspNetCore.Builder;
class S {
  void C(CorsPolicyBuilder b) {
    b.AllowAnyOrigin().AllowCredentials(); // EXPECT aspnet.cors-any-origin-credentials
  }
  void O(CookieBuilder c) {
    c.SecurePolicy = CookieSecurePolicy.None; // EXPECT aspnet.cookie-secure-none
  }
}
