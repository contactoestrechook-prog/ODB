import { Header } from '../ui/Header';
import { ChatSommelier } from './ChatSommelier';

export default function Sommelier() {
  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/sommelier" />
      <div className="max-w-2xl mx-auto p-6">
        <ChatSommelier />
      </div>
    </main>
  );
}
