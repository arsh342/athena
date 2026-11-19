class Sec {
  void c(HttpSecurity http) throws Exception {
    http.csrf().disable(); // EXPECT spring.csrf-disabled
    http.authorizeRequests().anyRequest().permitAll(); // EXPECT spring.permit-all-any-request
  }
}
@CrossOrigin(origins = "*") // EXPECT spring.cross-origin-wildcard
class Api {}
