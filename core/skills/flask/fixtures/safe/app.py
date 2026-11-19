from flask import Flask
from flask_cors import CORS
app = Flask(__name__)
CORS(app, origins=['https://app.example.org'])
app.config['SESSION_COOKIE_SECURE'] = True
