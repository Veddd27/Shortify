import pg from "pg";

const { Pool } = pg;

// A Pool (not a single Client) is the important choice here. A Client is one
// TCP connection to Postgres — if we used a single Client, two requests
// arriving at the same time would have to queue behind each other on the
// exact same connection. A Pool keeps several connections open and hands
// each incoming query whichever connection is free, so concurrent requests
// can actually run concurrently. Every "how does this app handle traffic"
// question later in this project routes back through this pool, so getting
// it right in Stage 1 matters.
const pool = new Pool({
    host: process.env.PGHOST,
    port: process.env.PGPORT,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    // max = how many simultaneous connections this app is allowed to open.
    // Left modest for now — this is exactly the kind of number we'll
    // revisit once we're load testing in Stage 7.
    max: 10,
});

export default pool;
