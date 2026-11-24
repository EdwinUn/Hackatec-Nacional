// Página de EJEMPLO: prueba que front → back → Postgres están conectados.
// Reemplázala por las pantallas reales del proyecto.
import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';

import { Item } from '../../core/models/item';
import { HealthService } from '../../core/services/health.service';
import { ItemsService } from '../../core/services/items.service';

@Component({
  selector: 'app-home',
  imports: [
    DatePipe,
    FormsModule,
    ButtonModule,
    CardModule,
    InputTextModule,
    MessageModule,
    TableModule,
    TagModule,
  ],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home implements OnInit {
  private readonly healthService = inject(HealthService);
  private readonly itemsService = inject(ItemsService);

  protected readonly backendStatus = signal<'cargando' | 'ok' | 'error'>('cargando');
  protected readonly items = signal<Item[]>([]);
  protected readonly error = signal<string | null>(null);
  protected newName = '';

  ngOnInit(): void {
    this.healthService.check().subscribe({
      next: () => this.backendStatus.set('ok'),
      error: () => this.backendStatus.set('error'),
    });
    this.loadItems();
  }

  protected loadItems(): void {
    this.itemsService.list().subscribe({
      next: (items) => this.items.set(items),
      error: () => this.error.set('No se pudieron cargar los items. ¿Está corriendo el backend?'),
    });
  }

  protected addItem(): void {
    const name = this.newName.trim();
    if (!name) return;
    this.itemsService.create({ name }).subscribe({
      next: (item) => {
        this.items.update((items) => [...items, item]);
        this.newName = '';
        this.error.set(null);
      },
      error: () => this.error.set('No se pudo crear el item.'),
    });
  }
}
