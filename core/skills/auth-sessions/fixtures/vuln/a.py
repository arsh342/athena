import bcrypt
salt = bcrypt.gensalt(rounds=6)  # EXPECT auth-sessions.bcrypt-low-rounds-py
