# IA

Scripts y prompts del componente de IA. El enfoque todavía está por definir.

## Estructura

```
ia/
├── prompts/   # Prompts versionados (.md o .txt), uno por tarea
├── scripts/   # Scripts de prueba, procesamiento o evaluación
├── data/      # Datos locales (NO se suben, ver .gitignore)
└── models/    # Modelos descargados (NO se suben)
```

## Convenciones

- Cada prompt en su propio archivo, con nombre descriptivo (`clasificar_reporte.md`).
- Las API keys van en `.env`, nunca en el código.
