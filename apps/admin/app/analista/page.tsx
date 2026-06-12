import { Header } from '../ui/Header';
import { ChatAnalista } from './ChatAnalista';

export default function Analista() {
  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/analista" />
      <div className="max-w-3xl mx-auto p-6">
        <ChatAnalista />
      </div>
    </main>
  );
}
