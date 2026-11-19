localStorage.setItem('authToken', t); // EXPECT auth-sessions.jwt-in-localstorage
bcrypt.hashSync(pw, 8); // EXPECT auth-sessions.bcrypt-low-cost
const t = jwt.sign({ id }, key); // EXPECT auth-sessions.jwt-without-expiry
