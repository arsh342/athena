import java.io.*;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.*;
import javax.crypto.Cipher;
import javax.servlet.http.*;
import javax.xml.parsers.DocumentBuilderFactory;

public class Controller extends HttpServlet {
  protected void doGet(HttpServletRequest request, HttpServletResponse response) throws Exception {
    String id = request.getParameter("id");
    PreparedStatement ps = conn.prepareStatement("SELECT * FROM users WHERE id = ?");
    ps.setString(1, id);
    ps.executeQuery();
    int n = Integer.parseInt(request.getParameter("n"));
    conn.createStatement().executeQuery("SELECT * FROM t WHERE n = " + n);
    String host = request.getParameter("host");
    Runtime.getRuntime().exec(new String[] {"ping", "-c", "1", host});
    new File(FilenameUtils.getName(id));
    response.getWriter().println(Encode.forHtml(id));
    response.sendRedirect("/home");
  }

  byte[] checksum(byte[] data) throws Exception {
    return MessageDigest.getInstance("MD5").digest(data);
  }

  String token() {
    byte[] b = new byte[32];
    new SecureRandom().nextBytes(b);
    return new String(b);
  }

  void crypto() throws Exception {
    Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
    DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
    dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
  }
}
