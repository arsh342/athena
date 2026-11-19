using System;
using System.IO;
using System.Security.Cryptography;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Mvc;

public class UserController : Controller
{
    public IActionResult Get([FromQuery] string id)
    {
        var cmd = new SqlCommand("SELECT * FROM users WHERE id = @id");
        cmd.Parameters.AddWithValue("@id", id);
        var n = int.Parse(Request.Query["n"]);
        var other = new SqlCommand("SELECT * FROM t WHERE n = " + n);
        var text = File.ReadAllText(Path.GetFileName(id));
        return Redirect("/home");
    }

    public IActionResult Show()
    {
        return Content(HtmlEncoder.Default.Encode(Request.Query["n"]));
    }

    public byte[] Checksum(byte[] data)
    {
        using var h = MD5.Create();
        return h.ComputeHash(data);
    }

    public byte[] ResetToken()
    {
        return RandomNumberGenerator.GetBytes(32);
    }
}
