import java.io.*;
import java.net.URL;
import java.security.MessageDigest;
import java.sql.*;
import java.util.Random;
import javax.crypto.Cipher;
import javax.servlet.http.*;
import javax.xml.parsers.DocumentBuilderFactory;

public class Controller extends HttpServlet {
  protected void doGet(HttpServletRequest request, HttpServletResponse response) throws Exception {
    String id = request.getParameter("id");
    Statement stmt = conn.createStatement();
    stmt.executeQuery("SELECT * FROM users WHERE id = " + id); // EXPECT taint.sql-injection
    Runtime.getRuntime().exec("ping " + request.getParameter("host")); // EXPECT taint.command-injection
    new FileInputStream("/data/" + id); // EXPECT taint.path-traversal
    response.sendRedirect(request.getParameter("next")); // EXPECT taint.open-redirect
    response.getWriter().println("<h1>" + id + "</h1>"); // EXPECT taint.xss
    ObjectInputStream ois = new ObjectInputStream(request.getInputStream()); // EXPECT taint.deserialization
    new URL(request.getParameter("u")); // EXPECT taint.ssrf
  }

  String hash(String password) throws Exception {
    return new String(MessageDigest.getInstance("MD5").digest(password.getBytes())); // EXPECT crypto.weak-hash
  }

  String token() {
    String resetToken = "" + new Random().nextInt(); // EXPECT crypto.insecure-random
    return resetToken;
  }

  void crypto() throws Exception {
    Cipher c = Cipher.getInstance("AES"); // EXPECT crypto.ecb-mode
    DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance(); // EXPECT xxe.parser-unhardened
    client.setHostnameVerifier((hostname, session) -> true); // EXPECT tls.verification-disabled
  }
}

@RestController
class Api {
  @GetMapping("/q")
  public String q(@RequestParam String name) {
    return jdbc.queryForObject("SELECT * FROM t WHERE n = '" + name + "'", String.class); // EXPECT taint.sql-injection
  }
}
