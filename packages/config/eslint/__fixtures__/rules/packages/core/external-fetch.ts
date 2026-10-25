export async function readExternal(): Promise<number> {
  const literal = await fetch('https://ecourts.example.gov.in/status');
  const template = await fetch(`https://ecourts.example.gov.in/${String(literal.status)}`);
  const relative = await fetch('/api/uploads');
  return template.status + relative.status;
}
