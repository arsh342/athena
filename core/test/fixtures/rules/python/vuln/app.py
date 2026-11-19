import hashlib
import os
import pickle
import random
import tempfile

import requests
import yaml
from flask import Flask, redirect, render_template_string, request

app = Flask(__name__)
DEBUG = True  # EXPECT config.debug-enabled


@app.route("/user")
def user():
    uid = request.args.get("id")
    cursor.execute("SELECT * FROM users WHERE id = " + uid)  # EXPECT taint.sql-injection
    cursor.execute(f"SELECT * FROM t WHERE n = '{uid}'")  # EXPECT taint.sql-injection
    os.system("ping " + request.args["host"])  # EXPECT taint.command-injection
    pickle.loads(request.data)  # EXPECT taint.deserialization
    open("/data/" + uid)  # EXPECT taint.path-traversal
    requests.get(request.args["u"])  # EXPECT taint.ssrf
    eval(request.json["c"])  # EXPECT taint.code-injection
    redirect(request.args.get("next"))  # EXPECT taint.open-redirect
    return render_template_string("<h1>" + uid)  # EXPECT taint.template-injection


def build(name):
    return "SELECT * FROM t WHERE n = '" + name + "'"


@app.route("/search")
def search():
    cursor.execute(build(request.args.get("q")))  # EXPECT taint.sql-injection


def hash_password(password):
    return hashlib.md5(password.encode()).hexdigest()  # EXPECT crypto.weak-hash


reset_token = random.randint(0, 999999)  # EXPECT crypto.insecure-random
resp = requests.get("https://example.com", verify=False)  # EXPECT tls.verification-disabled
config = yaml.load(open("c.yml"))  # EXPECT taint.deserialization
scratch = tempfile.mktemp()  # EXPECT config.insecure-temp-file

if __name__ == "__main__":
    app.run(debug=True)  # EXPECT config.debug-enabled
