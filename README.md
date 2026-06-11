# Rescue Command Center

Phase 3 adds the initial Next.js application foundation.

## Application Setup

1. Install Node.js LTS.
2. Install dependencies:

```bash
npm install
```

3. Copy the environment example:

```bash
cp .env.example .env.local
```

4. Fill in:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

5. Start the app:

```bash
npm run dev
```

6. Open:

```text
http://localhost:3000
```

## Current Pages

- `/login`
- `/incidents`
- `/incidents/[incidentId]`
- `/incidents/[incidentId]/sites`

The app uses the existing Supabase schema and does not modify database structure.
