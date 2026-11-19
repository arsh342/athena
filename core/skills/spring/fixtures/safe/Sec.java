class Sec {
  void c(HttpSecurity http) throws Exception {
    http.authorizeRequests().anyRequest().authenticated();
  }
}
@CrossOrigin(origins = "https://app.example.org")
class Api {}
