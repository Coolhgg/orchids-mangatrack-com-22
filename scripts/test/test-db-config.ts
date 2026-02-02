import pg from 'pg'
const { Client } = pg

async function main() {
  const client = new Client({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'postgres',
    password: process.env.DB_PASSWORD || '',
    port: 5432,
  })

  try {
    await client.connect()
    console.log('Connection successful with raw password!')
    const res = await client.query('SELECT 1')
    console.log('Query result:', res.rows)
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    console.error('Connection failed with raw password:', errorMessage)
  } finally {
    await client.end()
  }
}

main()
