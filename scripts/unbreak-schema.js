const fs = require('fs');
const path = require('path');

const schemaPath = path.join(process.cwd(), 'prisma/schema.prisma');
let schema = fs.readFileSync(schemaPath, 'utf8');

// Fix the corrupted metadata/payload defaults
// It looks like: @default("{\n\n  @@map("...")\n}")
schema = schema.replace(/@default\("{\n\n\s+@@map\("([^"]+)"\)\n\s+}"\)/g, '@default("{}")\n\n  @@map("$1")');

// Also handle the case where it might have been slightly different
schema = schema.replace(/@default\("{\s+@@map\("([^"]+)"\)\s+}"\)/g, '@default("{}")\n\n  @@map("$1")');

fs.writeFileSync(schemaPath, schema);
console.log('Schema corruption fixed');
