import { DataSource } from 'typeorm';
async function f(ds: DataSource, col: string) {
  return ds.query('SELECT ' + col + ' FROM users'); // EXPECT typeorm.query-concat
}
