import os
SECRET = os.environ.get('SECRET_KEY', 'changeme-in-prod')  # EXPECT insecure-defaults-code.env-secret-fallback
