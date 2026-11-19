import hashlib
import secrets
import subprocess

import yaml
from flask import Flask, redirect, request
from markupsafe import escape
from werkzeug.utils import secure_filename

app = Flask(__name__)


@app.route("/user")
def user():
    uid = request.args.get("id")
    cursor.execute("SELECT * FROM users WHERE id = %s", (uid,))
    n = int(request.args.get("n"))
    cursor.execute("SELECT * FROM t WHERE n = " + str(n))
    subprocess.run(["ping", "-c", "1", request.args["host"]])
    open("/data/" + secure_filename(request.args["name"]))
    redirect("/home")
    return "<h1>" + escape(uid) + "</h1>"


def checksum(data):
    return hashlib.md5(data).hexdigest()


session_token = secrets.token_hex(32)
config = yaml.safe_load(open("c.yml"))
