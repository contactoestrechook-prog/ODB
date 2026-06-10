import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const token = req.cookies.get('odb_token');
  const { pathname } = req.nextUrl;
  if (!token && pathname !== '/login') {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  if (token && pathname === '/login') {
    return NextResponse.redirect(new URL('/ventas', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|favicon.ico|api/).*)'],
};
