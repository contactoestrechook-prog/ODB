import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const respuesta = NextResponse.redirect(new URL('/login', req.url));
  respuesta.cookies.delete('odb_token');
  return respuesta;
}
