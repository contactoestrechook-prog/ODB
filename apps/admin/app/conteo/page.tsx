import { redirect } from 'next/navigation';

// El conteo cíclico (nunca se usó) pasó a ser el Arqueo de stock (24/10/2026):
// un solo lugar para contar.
export default function Conteo() {
  redirect('/arqueo');
}
