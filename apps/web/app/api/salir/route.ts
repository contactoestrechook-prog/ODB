import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const resp = NextResponse.redirect(new URL("/", req.url));
  resp.cookies.set("odb_cliente", "", { httpOnly: true, path: "/", maxAge: 0 });
  return resp;
}
