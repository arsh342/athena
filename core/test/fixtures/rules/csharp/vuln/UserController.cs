using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Runtime.Serialization.Formatters.Binary;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Mvc;

public class UserController : Controller
{
    public IActionResult Get([FromQuery] string id)
    {
        var cmd = new SqlCommand("SELECT * FROM users WHERE id = " + id); // EXPECT taint.sql-injection
        Process.Start(Request.Query["cmd"]); // EXPECT taint.command-injection
        var text = File.ReadAllText("/data/" + id); // EXPECT taint.path-traversal
        return Redirect(Request.Query["next"]); // EXPECT taint.open-redirect
    }

    public IActionResult Show()
    {
        return Content("<h1>" + Request.Query["n"] + "</h1>", "text/html"); // EXPECT taint.xss
    }

    public object Load(Stream s)
    {
        var f = new BinaryFormatter(); // EXPECT deserialization.insecure-formatter
        return f.Deserialize(s);
    }

    public byte[] HashPassword(string password)
    {
        using var h = MD5.Create(); // EXPECT crypto.weak-hash
        return h.ComputeHash(System.Text.Encoding.UTF8.GetBytes(password));
    }

    public int ResetToken()
    {
        var resetToken = new Random().Next(); // EXPECT crypto.insecure-random
        return resetToken;
    }

    public void Tls()
    {
        ServicePointManager.ServerCertificateValidationCallback += (s, c, ch, e) => true; // EXPECT tls.verification-disabled
    }
}
