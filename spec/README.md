# spec/ — Spec Driven Development

Documentación viva del proyecto Bento. La constitución define qué somos y cómo construimos; cada feature tiene su propia carpeta con spec, plan y checklist de tareas.

## Estructura

```
spec/
├── constitution/            ← reglas estables del proyecto
│   ├── mission.md           ← qué construimos y para quién
│   ├── tech-stack.md        ← tecnologías, convenciones y límites duros
│   └── roadmap.md           ← orden y estado de las features
└── features/                ← una carpeta por feature
    ├── _plantilla/          ← copiar esto para cada feature nueva
    │   ├── spec.md
    │   ├── plan.md
    │   └── tasks.md
    └── NNN-nombre-feature/
        ├── spec.md          ← qué hace + criterios de aceptación
        ├── plan.md          ← cómo se implementa
        └── tasks.md         ← checklist de tareas
```

## Flujo para una feature nueva

1. Agregar la tarea en **`tasks.md`** (raíz del proyecto) — si no está ahí, no se hace.
2. Crear `spec/features/NNN-nombre-feature/` copiando `_plantilla/`.
3. Escribir `spec.md`: qué hace, por qué y criterios de aceptación.
4. Escribir `plan.md`: enfoque técnico respetando `constitution/tech-stack.md`.
5. Desglosar en `tasks.md` de la feature y marcar el progreso al implementar.
6. Actualizar `constitution/roadmap.md` (mover a "Hecho") al terminar.

> La constitución manda: si una feature choca con `mission.md` o `tech-stack.md`, se replantea la feature, no la constitución.
