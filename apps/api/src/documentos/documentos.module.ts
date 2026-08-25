import { Module } from '@nestjs/common';
import { DocumentosController } from './documentos.controller';
import { supabaseProvider } from '../supabase.provider';

@Module({ controllers: [DocumentosController], providers: [supabaseProvider] })
export class DocumentosModule {}
