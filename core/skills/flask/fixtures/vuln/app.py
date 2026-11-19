from flask import Flask
from flask_cors import CORS
app = Flask(__name__)
CORS(app, origins='*')  # EXPECT flask.cors-wildcard
app.config['SESSION_COOKIE_SECURE'] = False  # EXPECT flask.session-cookie-insecure
