import { NextResponse } from 'next/server';

// Cierra la sesión y va al login. La dirección va RELATIVA («/login»): dentro
// del servidor req.url es http://localhost:3000, y con ella «Salir» mandaba al
// navegador a https://localhost:3000/login, una página que no abre (24/11/2026).
export async function GET() {
  const respuesta = new NextResponse(null, { status: 307, headers: { Location: '/login' } });
  respuesta.cookies.delete('odb_token');
  respuesta.cookies.delete('odb_cambiar');
  return respuesta;
}
