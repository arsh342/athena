document.cookie = 'x=1';
bcrypt.hashSync(pw, 12);
const t = jwt.sign({ id }, key, { expiresIn: '15m' });
