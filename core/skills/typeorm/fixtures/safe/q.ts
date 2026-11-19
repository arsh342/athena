import { DataSource } from 'typeorm';
async function f(ds: DataSource, id: number) {
  return ds.query('SELECT * FROM users WHERE id = $1', [id]);
}
