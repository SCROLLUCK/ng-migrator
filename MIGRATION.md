# Estrutura de Pastas de um Projeto Angular 20/21 (2026)

## 📋 Índice

- [Visão Geral](#visão-geral)
- [Mudanças no Angular 20/21](#mudanças-no-angular-2021)
- [Estrutura Raiz do Projeto](#estrutura-raiz-do-projeto)
- [Pasta `/src`](#pasta-src)
- [Pasta `/src/app`](#pasta-srcapp)
- [Organização Avançada (Standalone)](#organização-avançada-standalone)
- [Boas Práticas Angular 20/21](#boas-práticas-angular-2021)
- [Exemplos de Arquivos](#exemplos-de-arquivos)

---

## Visão Geral

Este guia apresenta a estrutura moderna de projetos Angular 20/21, que utiliza **Standalone Components** como padrão. Os módulos NgModule são considerados legados e não são mais recomendados.

```
meu-projeto-angular/
├── node_modules/          # Dependências do projeto
├── src/                   # Código fonte da aplicação
├── angular.json           # Configuração do Angular CLI
├── package.json           # Dependências e scripts npm
├── tsconfig.json          # Configuração do TypeScript
├── README.md              # Documentação do projeto
└── .gitignore            # Arquivos ignorados pelo Git
```

---

## Mudanças no Angular 20/21

### O que mudou desde Angular 11?

**Principais mudanças arquiteturais:**

1. ✅ **Standalone Components são o padrão** - NgModules são legados
2. ✅ **Signals** substituem grande parte do RxJS para state management
3. ✅ **inject()** function é preferida sobre constructor injection
4. ✅ **Control Flow Syntax** (`@if`, `@for`) substitui `*ngIf`, `*ngFor`
5. ✅ **app.config.ts** substitui `app.module.ts`
6. ✅ **Função providers** (`provideRouter`, `provideHttpClient`)
7. ✅ **Vite** é o bundler padrão (substitui Webpack)
8. ✅ **Lazy loading direto de componentes** (não mais módulos)

### Arquivos removidos/obsoletos

- ❌ `*.module.ts` (não são mais necessários)
- ❌ `app.module.ts` → substituído por `app.config.ts`
- ❌ `*-routing.module.ts` → substituído por `*.routes.ts`
- ❌ `polyfills.ts` (geralmente não necessário em 2026)

### Novos arquivos:

- ✅ `app.config.ts` - Configuração da aplicação
- ✅ `app.config.server.ts` - Configuração SSR (se usar)
- ✅ `*.routes.ts` - Definição de rotas
- ✅ Componentes standalone por padrão

---

## Estrutura Raiz do Projeto

### 📁 `node_modules/`

**Função:** Armazena todas as dependências instaladas via npm/yarn.

- **Não versionado** no Git (incluído no `.gitignore`)
- Gerado automaticamente ao executar `npm install`
- Pode ser deletado e recriado a qualquer momento

### 📄 `angular.json`

**Função:** Arquivo de configuração principal do Angular CLI.

**Responsabilidades:**

- Configurações de build (produção/desenvolvimento)
- Paths de assets, styles e scripts
- Configurações de testes
- Ambientes de deploy

**Exemplo:**

```json
{
  "projects": {
    "meu-app": {
      "architect": {
        "build": {
          "options": {
            "outputPath": "dist/meu-app",
            "index": "src/index.html",
            "main": "src/main.ts",
            "styles": ["src/styles.scss"],
            "scripts": []
          }
        }
      }
    }
  }
}
```

### 📄 `package.json`

**Função:** Gerencia dependências e scripts do projeto.

**Exemplo Angular 20/21:**

```json
{
  "name": "meu-projeto-angular",
  "version": "1.0.0",
  "scripts": {
    "ng": "ng",
    "start": "ng serve",
    "build": "ng build",
    "watch": "ng build --watch --configuration development",
    "test": "ng test",
    "lint": "ng lint",
    "serve:ssr": "node dist/meu-projeto-angular/server/server.mjs"
  },
  "dependencies": {
    "@angular/animations": "^21.0.0",
    "@angular/common": "^21.0.0",
    "@angular/compiler": "^21.0.0",
    "@angular/core": "^21.0.0",
    "@angular/forms": "^21.0.0",
    "@angular/platform-browser": "^21.0.0",
    "@angular/platform-browser-dynamic": "^21.0.0",
    "@angular/router": "^21.0.0",
    "rxjs": "~7.8.0",
    "tslib": "^2.6.0",
    "zone.js": "~0.14.0"
  },
  "devDependencies": {
    "@angular-devkit/build-angular": "^21.0.0",
    "@angular/cli": "^21.0.0",
    "@angular/compiler-cli": "^21.0.0",
    "typescript": "~5.4.0"
  }
}
```

**Mudanças notáveis:**

- TypeScript 5.4+ (anteriormente 4.8)
- RxJS 7.8+ com suporte melhorado a Signals
- Vite como bundler padrão (mais rápido que Webpack)
- SSR scripts incluídos por padrão

### 📄 `tsconfig.json`

**Função:** Configuração do compilador TypeScript.

**Principais configurações Angular 20/21:**

- Target ES2022 (anteriormente ES2020)
- Module ES2022
- Strict mode habilitado por padrão
- Path mapping para imports limpos

**Exemplo:**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "lib": ["ES2022", "dom"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "experimentalDecorators": true,
    "moduleResolution": "bundler",
    "baseUrl": "./",
    "paths": {
      "@app/*": ["src/app/*"],
      "@core/*": ["src/app/core/*"],
      "@shared/*": ["src/app/shared/*"],
      "@features/*": ["src/app/features/*"],
      "@environments/*": ["src/environments/*"]
    }
  }
}
```

**Nota:** `moduleResolution: "bundler"` é novo no Angular 20+ e otimizado para Vite.

### 📄 `.gitignore`

**Função:** Define arquivos/pastas que não devem ser versionados.

**Exemplo:**

```
node_modules/
dist/
.angular/
*.log
.env
```

---

## Pasta `/src`

### Estrutura Completa (Angular 20/21)

```
src/
├── app/                   # Código da aplicação
├── assets/               # Recursos estáticos
├── environments/         # Configurações de ambiente (opcional)
├── index.html           # HTML principal
├── main.ts              # Ponto de entrada da aplicação
└── styles.scss          # Estilos globais
```

**Arquivos removidos no Angular 20/21:**

- ❌ `polyfills.ts` - Não mais necessário para navegadores modernos
- ❌ `test.ts` - Configuração de testes agora no angular.json

### 📁 `src/assets/`

**Função:** Armazena recursos estáticos (imagens, fontes, arquivos JSON, etc.).

**Estrutura recomendada:**

```
assets/
├── images/
│   ├── logo.png
│   ├── logo.svg          # Prefira SVG em 2026
│   ├── icons/
│   └── backgrounds/
├── fonts/
│   └── custom-font.woff2
├── data/
│   └── mock-data.json
└── i18n/
    ├── pt-BR.json
    └── en-US.json
```

**Características:**

- Copiado automaticamente para `dist/` durante o build
- Acessível via path relativo: `assets/images/logo.png`
- Suporte a otimização de imagens no build (Angular 20+)

### 📁 `src/environments/`

**Função:** Gerencia configurações específicas por ambiente.

**Nota:** No Angular 20/21, environments são opcionais. Muitos projetos usam variáveis de ambiente do sistema.

**Estrutura (se usar):**

```
environments/
├── environment.ts          # Desenvolvimento
├── environment.prod.ts     # Produção
└── environment.staging.ts  # Staging (opcional)
```

**Exemplo - `environment.ts`:**

```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api',
  firebaseConfig: {
    apiKey: 'dev-key',
    authDomain: 'dev.firebaseapp.com',
  },
  enableDebug: true,
} as const;
```

**Alternativa moderna (usando process.env):**

```typescript
// Sem arquivo environment, direto no código
const apiUrl = import.meta.env['VITE_API_URL'] || 'http://localhost:3000/api';
```

### 📄 `src/index.html`

**Função:** Template HTML principal da SPA (Single Page Application).

**Exemplo Angular 20/21:**

```html
<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>Meu App Angular</title>
    <base href="/" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/x-icon" href="favicon.ico" />
    <!-- Preconnect para APIs externas -->
    <link rel="preconnect" href="https://api.exemplo.com" />
  </head>
  <body>
    <app-root></app-root>
  </body>
</html>
```

### 📄 `src/main.ts`

**Função:** Ponto de entrada (bootstrap) da aplicação Angular - **MUDANÇA IMPORTANTE**.

**Exemplo Angular 20/21 (Standalone):**

```typescript
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
```

**Comparação com Angular 11:**

```typescript
// Angular 11 (ANTIGO - com módulos)
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { AppModule } from './app/app.module';

platformBrowserDynamic()
  .bootstrapModule(AppModule)
  .catch((err) => console.error(err));

// Angular 20/21 (NOVO - standalone)
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
```

### 📄 `src/styles.scss`

**Função:** Estilos globais da aplicação.

**Exemplo:**

```scss
/* Reset e Imports */
@import 'tailwindcss/base';
@import 'tailwindcss/components';
@import 'tailwindcss/utilities';

/* Variáveis Globais */
:root {
  --primary-color: #1976d2;
  --secondary-color: #424242;
  --font-family: 'Roboto', sans-serif;
}

/* Estilos Globais */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: var(--font-family);
  color: #333;
}

/* Utility Classes */
.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 1rem;
}
```

---

## Pasta `/src/app` (Angular 20/21 Standalone)

### Estrutura Básica (SEM MÓDULOS)

```
app/
├── app.component.ts       # Componente raiz (standalone)
├── app.component.html     # Template do componente raiz
├── app.component.scss     # Estilos do componente raiz
├── app.component.spec.ts  # Testes do componente raiz
├── app.config.ts          # Configuração da aplicação (substitui app.module.ts)
└── app.routes.ts          # Configuração de rotas (substitui app-routing.module.ts)
```

### 📄 `app.component.ts` (Standalone)

**Função:** Componente principal da aplicação.

**Exemplo Angular 20/21:**

```typescript
import { Component, OnInit, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-root',
  standalone: true, // ← STANDALONE!
  imports: [CommonModule, RouterOutlet], // ← Imports direto aqui
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit {
  // Usando Signals (Angular 16+)
  title = signal('Meu Projeto Angular 20/21');

  ngOnInit(): void {
    console.log('App inicializado');
  }
}
```

**Template com nova sintaxe:**

```html
<!-- app.component.html -->
<header>
  <h1>{{ title() }}</h1>
  <!-- Signals usam () -->
</header>

<main>
  <router-outlet />
</main>

<footer>
  <p>© 2026 Meu Projeto</p>
</footer>
```

### 📄 `app.config.ts` (SUBSTITUI app.module.ts)

**Função:** Configuração central da aplicação com providers.

**Exemplo Angular 20/21:**

```typescript
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';

import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    // Detecção de mudanças otimizada
    provideZoneChangeDetection({ eventCoalescing: true }),

    // Roteamento com binding de inputs
    provideRouter(
      routes,
      withComponentInputBinding(), // Route params como @Input()
    ),

    // HTTP Client com interceptors funcionais
    provideHttpClient(withInterceptors([authInterceptor])),

    // Animações
    provideAnimations(),

    // Seus serviços globais (se necessário)
    // AuthService, // Geralmente usa providedIn: 'root'
  ],
};
```

**Comparação:**

```typescript
// ANTES (Angular 11 - app.module.ts)
@NgModule({
  declarations: [AppComponent],
  imports: [BrowserModule, AppRoutingModule, HttpClientModule],
  providers: [{ provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true }],
  bootstrap: [AppComponent],
})
export class AppModule {}

// DEPOIS (Angular 20/21 - app.config.ts)
export const appConfig: ApplicationConfig = {
  providers: [provideRouter(routes), provideHttpClient(withInterceptors([authInterceptor]))],
};
```

### 📄 `app.routes.ts` (SUBSTITUI app-routing.module.ts)

**Função:** Define as rotas da aplicação.

**Exemplo Angular 20/21:**

```typescript
import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: '/home',
    pathMatch: 'full',
  },
  {
    path: 'home',
    loadComponent: () => import('./pages/home/home.component').then((m) => m.HomeComponent),
  },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
    canActivate: [authGuard], // Guard funcional
  },
  {
    path: 'products',
    loadChildren: () => import('./features/products/products.routes').then((m) => m.PRODUCT_ROUTES), // Lazy load de rotas, não módulos
  },
  {
    path: '**',
    redirectTo: '/home',
  },
];
```

**Comparação:**

```typescript
// ANTES (Angular 11)
const routes: Routes = [
  {
    path: 'dashboard',
    loadChildren: () =>
      import('./features/dashboard/dashboard.module').then((m) => m.DashboardModule), // ← Carrega MÓDULO
  },
];

// DEPOIS (Angular 20/21)
const routes: Routes = [
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent), // ← Carrega COMPONENTE direto
  },
];
```

---

## Organização Avançada (Standalone)

### Estrutura Completa Recomendada Angular 20/21

```
src/app/
├── core/                      # Funcionalidades singleton
│   ├── guards/               # Guards funcionais
│   ├── interceptors/         # Interceptors funcionais
│   ├── services/             # Serviços globais
│   └── models/               # Interfaces/types globais
│
├── shared/                   # Recursos compartilhados
│   ├── components/           # Componentes standalone reutilizáveis
│   ├── directives/           # Diretivas standalone
│   ├── pipes/                # Pipes standalone
│   └── utils/                # Funções utilitárias
│
├── features/                 # Funcionalidades standalone
│   ├── auth/
│   │   ├── components/
│   │   ├── services/
│   │   └── auth.routes.ts    # ← .routes.ts, não .module.ts
│   │
│   ├── dashboard/
│   │   ├── components/
│   │   ├── services/
│   │   └── dashboard.routes.ts
│   │
│   └── products/
│       ├── components/
│       │   ├── product-list.component.ts
│       │   ├── product-detail.component.ts
│       │   └── product-form.component.ts
│       ├── services/
│       │   └── product.service.ts
│       └── products.routes.ts
│
├── layout/                   # Componentes standalone de layout
│   ├── header.component.ts
│   ├── footer.component.ts
│   └── sidebar.component.ts
│
├── pages/                    # Páginas standalone
│   ├── home.component.ts
│   └── not-found.component.ts
│
├── app.component.ts          # Root component (standalone)
├── app.config.ts             # App configuration
└── app.routes.ts             # Root routes
```

**Mudanças principais:**

- ❌ Sem arquivos `.module.ts`
- ✅ Tudo é standalone por padrão
- ✅ Arquivos `.routes.ts` para cada feature
- ✅ Componentes importam suas dependências diretamente

---

## 📁 Detalhamento de Pastas Principais

### `core/` - Núcleo da Aplicação

**Função:** Contém serviços singleton e funcionalidades essenciais.

**Regras:**

- Serviços com `providedIn: 'root'`
- Guards e interceptors **funcionais** (não mais classes)
- Não tem componentes visuais

#### `core/guards/`

**Função:** Protege rotas com lógica de autorização - **GUARDS FUNCIONAIS**.

**Exemplo Angular 20/21 - `auth.guard.ts`:**

```typescript
import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

// Guard funcional (não mais classe)
export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService); // ← inject() function
  const router = inject(Router);

  if (authService.isAuthenticated()) {
    return true;
  }

  router.navigate(['/login'], {
    queryParams: { returnUrl: state.url },
  });
  return false;
};

// Guard com lógica assíncrona
export const roleGuard: CanActivateFn = async (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const user = await authService.getCurrentUser();
  const requiredRole = route.data['role'] as string;

  if (user && user.role === requiredRole) {
    return true;
  }

  router.navigate(['/unauthorized']);
  return false;
};
```

**Comparação com Angular 11:**

```typescript
// ANTES (Angular 11 - Classe)
@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private router: Router,
  ) {}

  canActivate(): boolean {
    if (this.authService.isAuthenticated()) {
      return true;
    }
    this.router.navigate(['/login']);
    return false;
  }
}

// DEPOIS (Angular 20/21 - Função)
export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated()) {
    return true;
  }
  router.navigate(['/login']);
  return false;
};
```

#### `core/interceptors/`

**Função:** Intercepta requisições HTTP - **INTERCEPTORS FUNCIONAIS**.

**Exemplo Angular 20/21 - `auth.interceptor.ts`:**

```typescript
import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';

// Interceptor funcional (não mais classe)
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const token = authService.getToken();

  if (token) {
    const clonedReq = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`,
      },
    });
    return next(clonedReq);
  }

  return next(req);
};

// Interceptor com tratamento de erros
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401) {
        // Redirecionar para login
        inject(Router).navigate(['/login']);
      }
      return throwError(() => error);
    }),
  );
};

// Interceptor de loading
export const loadingInterceptor: HttpInterceptorFn = (req, next) => {
  const loadingService = inject(LoadingService);

  loadingService.show();

  return next(req).pipe(finalize(() => loadingService.hide()));
};
```

**Configuração no app.config.ts:**

```typescript
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { errorInterceptor } from './core/interceptors/error.interceptor';
import { loadingInterceptor } from './core/interceptors/loading.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(withInterceptors([authInterceptor, loadingInterceptor, errorInterceptor])),
  ],
};
```

**Comparação com Angular 11:**

```typescript
// ANTES (Angular 11 - Classe)
@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  intercept(req: HttpRequest<any>, next: HttpHandler) {
    const token = localStorage.getItem('token');
    if (token) {
      const clonedReq = req.clone({
        headers: req.headers.set('Authorization', `Bearer ${token}`),
      });
      return next.handle(clonedReq);
    }
    return next.handle(req);
  }
}

// Configuração no módulo
providers: [{ provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true }];

// DEPOIS (Angular 20/21 - Função)
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(AuthService).getToken();
  if (token) {
    req = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` },
    });
  }
  return next(req);
};

// Configuração no app.config.ts
provideHttpClient(withInterceptors([authInterceptor]));
```

#### `core/services/`

**Função:** Serviços globais da aplicação.

**Exemplo Angular 20/21 - `auth.service.ts`:**

```typescript
import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { environment } from '@environments/environment';
import { User } from '../models/user.model';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  // Usando inject() ao invés de constructor injection
  private http = inject(HttpClient);
  private router = inject(Router);

  // Usando Signals para state management
  private currentUserSignal = signal<User | null>(null);

  // Computed signals (derivados)
  public currentUser = this.currentUserSignal.asReadonly();
  public isAuthenticated = computed(() => !!this.currentUserSignal());
  public isAdmin = computed(() => this.currentUserSignal()?.role === 'admin');

  constructor() {
    // Restaurar usuário do localStorage
    const storedUser = localStorage.getItem('currentUser');
    if (storedUser) {
      this.currentUserSignal.set(JSON.parse(storedUser));
    }
  }

  login(email: string, password: string): Observable<User> {
    return this.http.post<User>(`${environment.apiUrl}/auth/login`, { email, password }).pipe(
      tap((user) => {
        this.currentUserSignal.set(user);
        localStorage.setItem('currentUser', JSON.stringify(user));
      }),
    );
  }

  logout(): void {
    this.currentUserSignal.set(null);
    localStorage.removeItem('currentUser');
    this.router.navigate(['/login']);
  }

  getToken(): string | null {
    return this.currentUserSignal()?.token || null;
  }

  updateUser(user: Partial<User>): void {
    const current = this.currentUserSignal();
    if (current) {
      const updated = { ...current, ...user };
      this.currentUserSignal.set(updated);
      localStorage.setItem('currentUser', JSON.stringify(updated));
    }
  }
}
```

**Comparação com Angular 11:**

```typescript
// ANTES (Angular 11 - BehaviorSubject + Constructor Injection)
@Injectable({ providedIn: 'root' })
export class AuthService {
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  constructor(
    private http: HttpClient,
    private router: Router,
  ) {
    const user = localStorage.getItem('currentUser');
    if (user) {
      this.currentUserSubject.next(JSON.parse(user));
    }
  }

  isAuthenticated(): boolean {
    return !!this.currentUserSubject.value;
  }
}

// DEPOIS (Angular 20/21 - Signals + inject())
@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  private currentUserSignal = signal<User | null>(null);
  public isAuthenticated = computed(() => !!this.currentUserSignal());

  // ...
}
```

**Vantagens dos Signals:**

- ✅ Change detection mais eficiente
- ✅ API mais simples que RxJS para estado
- ✅ Derivação automática com computed()
- ✅ Não precisa unsubscribe

#### `core/models/`

**Função:** Interfaces e classes de domínio globais.

**Exemplo - `user.model.ts`:**

```typescript
export interface User {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'user' | 'guest';
  createdAt: Date;
}

export class UserModel implements User {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'user' | 'guest';
  createdAt: Date;

  constructor(data: Partial<User>) {
    this.id = data.id || 0;
    this.name = data.name || '';
    this.email = data.email || '';
    this.role = data.role || 'guest';
    this.createdAt = data.createdAt || new Date();
  }

  get isAdmin(): boolean {
    return this.role === 'admin';
  }
}
```

---

### `shared/` - Recursos Compartilhados

**Função:** Componentes, diretivas e pipes standalone reutilizáveis.

**Regras:**

- Todos os recursos são **standalone**
- Podem ser importados em qualquer feature
- Sem dependências de `core/` ou `features/`

#### `shared/components/`

**Exemplos de componentes standalone:**

- Botões customizados
- Cards
- Modais
- Loaders
- Breadcrumbs

**Exemplo Angular 20/21 - `button/button.component.ts`:**

```typescript
import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-button',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button
      [type]="type()"
      [disabled]="disabled()"
      [class]="classes()"
      (click)="handleClick($event)"
    >
      <ng-content />
    </button>
  `,
  styleUrls: ['./button.component.scss'],
})
export class ButtonComponent {
  // Novos input/output signals (Angular 17+)
  type = input<'button' | 'submit'>('button');
  variant = input<'primary' | 'secondary' | 'danger'>('primary');
  disabled = input(false);

  // Output como função
  onClick = output<Event>();

  // Computed signal para classes
  classes = computed(() => `btn btn-${this.variant()}`);

  handleClick(event: Event): void {
    if (!this.disabled()) {
      this.onClick.emit(event);
    }
  }
}
```

**Uso no template:**

```html
<!-- Nova sintaxe de control flow -->
@if (isLoading()) {
<app-button variant="primary" disabled> Carregando... </app-button>
} @else {
<app-button variant="primary" (onClick)="handleSubmit()"> Enviar </app-button>
}
```

**Comparação com Angular 11:**

```typescript
// ANTES (Angular 11)
@Component({
  selector: 'app-button',
  template: `
    <button
      [type]="type"
      [disabled]="disabled"
      (click)="onClick.emit($event)">
      <ng-content></ng-content>
    </button>
  `
})
export class ButtonComponent {
  @Input() type: 'button' | 'submit' = 'button';
  @Input() variant = 'primary';
  @Input() disabled = false;
  @Output() onClick = new EventEmitter<Event>();
}

// Template
<app-button
  *ngIf="!isLoading; else loading"
  [variant]="'primary'"
  (onClick)="handleSubmit()">
  Enviar
</app-button>

// DEPOIS (Angular 20/21)
@Component({
  standalone: true,
  // ...
})
export class ButtonComponent {
  type = input<'button' | 'submit'>('button');
  variant = input('primary');
  disabled = input(false);
  onClick = output<Event>();
}

// Template
@if (!isLoading()) {
  <app-button
    variant="primary"
    (onClick)="handleSubmit()">
    Enviar
  </app-button>
}
```

#### `shared/directives/`

**Função:** Diretivas standalone reutilizáveis.

**Exemplo Angular 20/21 - `highlight.directive.ts`:**

```typescript
import { Directive, ElementRef, HostListener, input, inject } from '@angular/core';

@Directive({
  selector: '[appHighlight]',
  standalone: true,
})
export class HighlightDirective {
  // Usando inject() function
  private el = inject(ElementRef);

  // Input signal
  highlightColor = input('yellow');

  @HostListener('mouseenter') onMouseEnter() {
    this.highlight(this.highlightColor());
  }

  @HostListener('mouseleave') onMouseLeave() {
    this.highlight('');
  }

  private highlight(color: string): void {
    this.el.nativeElement.style.backgroundColor = color;
  }
}
```

**Uso:**

```typescript
// No componente
import { HighlightDirective } from '@shared/directives/highlight.directive';

@Component({
  standalone: true,
  imports: [HighlightDirective], // ← Importar diretamente
  template: `<p appHighlight highlightColor="lightblue">Passe o mouse aqui</p>`,
})
export class MyComponent {}
```

#### `shared/pipes/`

**Função:** Transformação de dados nos templates.

**Exemplo Angular 20/21 - `truncate.pipe.ts`:**

```typescript
import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'truncate',
  standalone: true,
})
export class TruncatePipe implements PipeTransform {
  transform(value: string, limit = 25, ellipsis = '...'): string {
    if (!value) return '';
    return value.length > limit ? value.substring(0, limit) + ellipsis : value;
  }
}
```

**Uso no template com nova sintaxe:**

```html
<!-- Importar no componente -->
@Component({ standalone: true, imports: [TruncatePipe] })

<!-- Usar no template -->
<p>{{ longText | truncate:50:'...' }}</p>

<!-- Com control flow -->
@if (description) {
<p>{{ description | truncate:100 }}</p>
}
```

---

### `features/` - Funcionalidades Standalone

**Função:** Agrupa funcionalidades específicas em componentes standalone com rotas.

**Benefícios:**

- Lazy loading direto de componentes
- Manutenção facilitada
- Zero boilerplate de módulos

#### Exemplo: `features/products/`

```
products/
├── components/
│   ├── product-list.component.ts
│   ├── product-detail.component.ts
│   └── product-form.component.ts
│
├── services/
│   └── product.service.ts
│
├── models/
│   └── product.model.ts
│
└── products.routes.ts  # ← Rotas, não módulo!
```

**`products.routes.ts` (Angular 20/21):**

```typescript
import { Routes } from '@angular/router';
import { ProductListComponent } from './components/product-list.component';
import { ProductDetailComponent } from './components/product-detail.component';
import { ProductFormComponent } from './components/product-form.component';

export const PRODUCT_ROUTES: Routes = [
  {
    path: '',
    component: ProductListComponent,
  },
  {
    path: 'new',
    component: ProductFormComponent,
  },
  {
    path: ':id',
    component: ProductDetailComponent,
  },
  {
    path: ':id/edit',
    component: ProductFormComponent,
  },
];
```

**Integração no `app.routes.ts`:**

```typescript
export const routes: Routes = [
  {
    path: 'products',
    loadChildren: () => import('./features/products/products.routes').then((m) => m.PRODUCT_ROUTES), // ← Lazy load de rotas
  },
];
```

**`components/product-list.component.ts`:**

```typescript
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ProductService } from '../services/product.service';
import { Product } from '../models/product.model';
import { CardComponent } from '@shared/components/card.component';

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [CommonModule, RouterLink, CardComponent],
  template: `
    <div class="container">
      <h1>Produtos</h1>

      <a routerLink="/products/new" class="btn btn-primary"> Novo Produto </a>

      @if (loading()) {
        <p>Carregando...</p>
      } @else if (error()) {
        <p class="error">{{ error() }}</p>
      } @else {
        <div class="products-grid">
          @for (product of products(); track product.id) {
            <app-card>
              <h3>{{ product.name }}</h3>
              <p>{{ product.description }}</p>
              <span>R$ {{ product.price }}</span>
              <a [routerLink]="['/products', product.id]">Ver detalhes</a>
            </app-card>
          } @empty {
            <p>Nenhum produto encontrado.</p>
          }
        </div>
      }
    </div>
  `,
  styleUrls: ['./product-list.component.scss'],
})
export class ProductListComponent implements OnInit {
  private productService = inject(ProductService);

  // State com signals
  products = signal<Product[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);

  ngOnInit(): void {
    this.loadProducts();
  }

  private loadProducts(): void {
    this.productService.getAll().subscribe({
      next: (data) => {
        this.products.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set('Erro ao carregar produtos');
        this.loading.set(false);
      },
    });
  }
}
```

**Comparação com Angular 11:**

```typescript
// ANTES (Angular 11 - com módulo)
// products.module.ts
@NgModule({
  declarations: [ProductListComponent, ProductDetailComponent],
  imports: [CommonModule, ProductsRoutingModule, SharedModule],
})
export class ProductsModule {}

// products-routing.module.ts
@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ProductsRoutingModule {}

// DEPOIS (Angular 20/21 - standalone)
// products.routes.ts
export const PRODUCT_ROUTES: Routes = [{ path: '', component: ProductListComponent }];

// Componente standalone
@Component({
  standalone: true,
  imports: [CommonModule, RouterLink, CardComponent],
})
export class ProductListComponent {}
```

**`services/product.service.ts` (Angular 20/21):**

```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@environments/environment';
import { Product } from '../models/product.model';

@Injectable({
  providedIn: 'root',
})
export class ProductService {
  private http = inject(HttpClient); // ← inject() function
  private apiUrl = `${environment.apiUrl}/products`;

  getAll(): Observable<Product[]> {
    return this.http.get<Product[]>(this.apiUrl);
  }

  getById(id: number): Observable<Product> {
    return this.http.get<Product>(`${this.apiUrl}/${id}`);
  }

  create(product: Product): Observable<Product> {
    return this.http.post<Product>(this.apiUrl, product);
  }

  update(id: number, product: Product): Observable<Product> {
    return this.http.put<Product>(`${this.apiUrl}/${id}`, product);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}
```

**Comparação:**

```typescript
// ANTES (Angular 11)
constructor(private http: HttpClient) {}

// DEPOIS (Angular 20/21)
private http = inject(HttpClient);
```

---

### `layout/` - Componentes de Layout Standalone

**Função:** Estrutura visual da aplicação.

```
layout/
├── header.component.ts      # Standalone component
├── footer.component.ts      # Standalone component
└── sidebar.component.ts     # Standalone component
```

**Exemplo Angular 20/21 - `header.component.ts`:**

```typescript
import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '@core/services/auth.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  template: `
    <header class="header">
      <div class="container">
        <div class="header__logo">
          <img src="assets/images/logo.svg" alt="Logo" />
        </div>

        <nav class="header__nav">
          <a routerLink="/home" routerLinkActive="active">Home</a>
          <a routerLink="/products" routerLinkActive="active">Produtos</a>
          <a routerLink="/about" routerLinkActive="active">Sobre</a>
        </nav>

        @if (currentUser(); as user) {
          <div class="header__user">
            <span>{{ user.name }}</span>
            @if (isAdmin()) {
              <span class="badge">Admin</span>
            }
            <button (click)="logout()">Sair</button>
          </div>
        } @else {
          <div class="header__auth">
            <a routerLink="/login">Entrar</a>
          </div>
        }
      </div>
    </header>
  `,
  styleUrls: ['./header.component.scss'],
})
export class HeaderComponent {
  private authService = inject(AuthService);

  // Signals do AuthService
  currentUser = this.authService.currentUser;
  isAdmin = this.authService.isAdmin;

  logout(): void {
    this.authService.logout();
  }
}
```

**Uso no App Component:**

```typescript
// app.component.ts
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './layout/header.component';
import { FooterComponent } from './layout/footer.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, FooterComponent],
  template: `
    <app-header />
    <main>
      <router-outlet />
    </main>
    <app-footer />
  `,
})
export class AppComponent {}
```

**Comparação com Angular 11:**

```typescript
// ANTES (Angular 11 - com módulo)
// layout.module.ts
@NgModule({
  declarations: [HeaderComponent, FooterComponent, SidebarComponent],
  imports: [CommonModule, RouterModule],
  exports: [HeaderComponent, FooterComponent, SidebarComponent]
})
export class LayoutModule {}

// app.module.ts
@NgModule({
  imports: [LayoutModule]
})

// Template com *ngIf
<div class="header__user" *ngIf="currentUser$ | async as user">
  <span>{{ user.name }}</span>
</div>

// DEPOIS (Angular 20/21 - standalone)
@Component({
  standalone: true,
  imports: [CommonModule, RouterLink]
})
export class HeaderComponent {}

// Importar direto no app.component
@Component({
  standalone: true,
  imports: [HeaderComponent, FooterComponent]
})

// Template com @if e signals
@if (currentUser(); as user) {
  <div class="header__user">
    <span>{{ user.name }}</span>
  </div>
}
```

---

## Boas Práticas Angular 20/21

### 1. Nomenclatura de Arquivos

```
✅ CORRETO:
user-list.component.ts
auth.service.ts
product.model.ts
highlight.directive.ts
date-format.pipe.ts
products.routes.ts

❌ INCORRETO:
UserList.ts
authService.ts
ProductModel.ts
products.module.ts (obsoleto)
```

### 2. Organização por Feature (Feature-based)

```
✅ RECOMENDADO:
features/
├── products/
│   ├── components/
│   ├── services/
│   ├── models/
│   └── products.routes.ts

❌ NÃO RECOMENDADO (Type-based):
components/
├── product-list.component.ts
├── user-profile.component.ts
services/
├── product.service.ts
├── user.service.ts
```

### 3. Lazy Loading de Componentes

**Sempre use lazy loading para features:**

```typescript
// app.routes.ts
export const routes: Routes = [
  {
    path: 'products',
    loadComponent: () =>
      import('./features/products/product-list.component').then((m) => m.ProductListComponent),
  },
  {
    path: 'dashboard',
    loadChildren: () =>
      import('./features/dashboard/dashboard.routes').then((m) => m.DASHBOARD_ROUTES),
  },
];
```

### 4. Use inject() ao invés de Constructor Injection

```typescript
// ✅ RECOMENDADO (Angular 20/21)
export class ProductService {
  private http = inject(HttpClient);
  private router = inject(Router);
}

// ❌ EVITE (ainda funciona, mas inject() é preferido)
export class ProductService {
  constructor(
    private http: HttpClient,
    private router: inject(Router);
  ) {}
}
```

### 5. Prefira Signals ao invés de RxJS para State

```typescript
// ✅ RECOMENDADO - Signals
export class ProductService {
  private productsSignal = signal<Product[]>([]);
  products = this.productsSignal.asReadonly();
  productCount = computed(() => this.productsSignal().length);
}

// ⚠️ USE RxJS apenas quando necessário (HTTP, eventos complexos)
export class ProductService {
  getAll(): Observable<Product[]> {
    // ← HTTP retorna Observable
    return this.http.get<Product[]>(this.apiUrl);
  }
}
```

### 6. Use Nova Sintaxe de Control Flow

```html
<!-- ✅ RECOMENDADO (Angular 17+) -->
@if (isLoading()) {
<p>Carregando...</p>
} @else {
<ul>
  @for (item of items(); track item.id) {
  <li>{{ item.name }}</li>
  } @empty {
  <li>Nenhum item encontrado</li>
  }
</ul>
}

<!-- ❌ EVITE (sintaxe antiga, ainda funciona) -->
<p *ngIf="isLoading">Carregando...</p>
<ul *ngIf="!isLoading">
  <li *ngFor="let item of items">{{ item.name }}</li>
</ul>
```

### 7. Input/Output Signals

```typescript
// ✅ RECOMENDADO (Angular 17.1+)
export class ButtonComponent {
  label = input.required<string>();
  disabled = input(false);
  onClick = output<void>();
}

// ❌ EVITE (sintaxe antiga)
export class ButtonComponent {
  @Input({ required: true }) label!: string;
  @Input() disabled = false;
  @Output() onClick = new EventEmitter<void>();
}
```

### 8. Guards e Interceptors Funcionais

```typescript
// ✅ RECOMENDADO - Guards funcionais
export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  return authService.isAuthenticated();
};

// ✅ RECOMENDADO - Interceptors funcionais
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(AuthService).getToken();
  if (token) {
    req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
  return next(req);
};

// ❌ EVITE - Classes (sintaxe legada)
@Injectable()
export class AuthGuard implements CanActivate {}
```

### 9. Estrutura de Componentes Standalone

```
product-card/
├── product-card.component.ts       # Lógica + metadata standalone
├── product-card.component.html     # Template (opcional, pode ser inline)
├── product-card.component.scss     # Estilos
└── product-card.component.spec.ts  # Testes
```

### 10. Path Mapping no tsconfig.json

```json
{
  "compilerOptions": {
    "paths": {
      "@app/*": ["src/app/*"],
      "@core/*": ["src/app/core/*"],
      "@shared/*": ["src/app/shared/*"],
      "@features/*": ["src/app/features/*"],
      "@environments/*": ["src/environments/*"]
    }
  }
}
```

**Uso:**

```typescript
// ✅ RECOMENDADO
import { AuthService } from '@core/services/auth.service';
import { ButtonComponent } from '@shared/components/button.component';

// ❌ EVITE
import { AuthService } from '../../../core/services/auth.service';
```

### 11. Smart vs Presentation Components

```typescript
// ✅ Smart Component (Container) - gerencia estado e lógica
@Component({
  standalone: true,
  imports: [ProductListComponent],
  template: `
    <app-product-list
      [products]="products()"
      [loading]="loading()"
      (productSelected)="onProductSelected($event)"
    />
  `,
})
export class ProductListContainerComponent {
  private productService = inject(ProductService);
  products = signal<Product[]>([]);
  loading = signal(true);

  ngOnInit() {
    this.productService.getAll().subscribe((data) => {
      this.products.set(data);
      this.loading.set(false);
    });
  }
}

// ✅ Presentation Component - apenas exibe dados
@Component({
  standalone: true,
  template: `
    @if (loading()) {
      <p>Carregando...</p>
    } @else {
      @for (product of products(); track product.id) {
        <div (click)="productSelected.emit(product)">
          {{ product.name }}
        </div>
      }
    }
  `,
})
export class ProductListComponent {
  products = input.required<Product[]>();
  loading = input(false);
  productSelected = output<Product>();
}
```

### 12. Evite NgModules

```typescript
// ❌ NÃO CRIE MAIS (legado)
@NgModule({
  declarations: [ProductListComponent],
  imports: [CommonModule],
  exports: [ProductListComponent],
})
export class ProductsModule {}

// ✅ USE COMPONENTES STANDALONE
@Component({
  standalone: true,
  imports: [CommonModule],
})
export class ProductListComponent {}
```

---

## Estrutura Completa de Exemplo (Angular 20/21)

```
meu-projeto-angular/
│
├── node_modules/
│
├── src/
│   ├── app/
│   │   ├── core/
│   │   │   ├── guards/
│   │   │   │   ├── auth.guard.ts
│   │   │   │   └── role.guard.ts
│   │   │   ├── interceptors/
│   │   │   │   ├── auth.interceptor.ts
│   │   │   │   ├── error.interceptor.ts
│   │   │   │   └── loading.interceptor.ts
│   │   │   ├── services/
│   │   │   │   ├── auth.service.ts
│   │   │   │   ├── storage.service.ts
│   │   │   │   └── notification.service.ts
│   │   │   └── models/
│   │   │       ├── user.model.ts
│   │   │       └── api-response.model.ts
│   │   │
│   │   ├── shared/
│   │   │   ├── components/
│   │   │   │   ├── button.component.ts
│   │   │   │   ├── card.component.ts
│   │   │   │   ├── modal.component.ts
│   │   │   │   └── loader.component.ts
│   │   │   ├── directives/
│   │   │   │   ├── highlight.directive.ts
│   │   │   │   └── tooltip.directive.ts
│   │   │   ├── pipes/
│   │   │   │   ├── truncate.pipe.ts
│   │   │   │   └── date-format.pipe.ts
│   │   │   └── utils/
│   │   │       └── form-validators.ts
│   │   │
│   │   ├── features/
│   │   │   ├── auth/
│   │   │   │   ├── components/
│   │   │   │   │   ├── login.component.ts
│   │   │   │   │   └── register.component.ts
│   │   │   │   └── auth.routes.ts
│   │   │   │
│   │   │   ├── dashboard/
│   │   │   │   ├── components/
│   │   │   │   │   └── dashboard.component.ts
│   │   │   │   ├── services/
│   │   │   │   │   └── dashboard.service.ts
│   │   │   │   └── dashboard.routes.ts
│   │   │   │
│   │   │   └── products/
│   │   │       ├── components/
│   │   │       │   ├── product-list.component.ts
│   │   │       │   ├── product-detail.component.ts
│   │   │       │   └── product-form.component.ts
│   │   │       ├── services/
│   │   │       │   └── product.service.ts
│   │   │       ├── models/
│   │   │       │   └── product.model.ts
│   │   │       └── products.routes.ts
│   │   │
│   │   ├── layout/
│   │   │   ├── header.component.ts
│   │   │   ├── footer.component.ts
│   │   │   └── sidebar.component.ts
│   │   │
│   │   ├── pages/
│   │   │   ├── home.component.ts
│   │   │   └── not-found.component.ts
│   │   │
│   │   ├── app.component.ts
│   │   ├── app.config.ts
│   │   └── app.routes.ts
│   │
│   ├── assets/
│   │   ├── images/
│   │   ├── fonts/
│   │   └── i18n/
│   │
│   ├── environments/
│   │   ├── environment.ts
│   │   └── environment.prod.ts
│   │
│   ├── index.html
│   ├── main.ts
│   └── styles.scss
│
├── angular.json
├── package.json
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.spec.json
├── README.md
└── .gitignore
```

**Diferenças principais do Angular 11:**

- ❌ Sem arquivos `*.module.ts`
- ❌ Sem `polyfills.ts`
- ✅ Arquivos `*.routes.ts` para rotas
- ✅ `app.config.ts` ao invés de `app.module.ts`
- ✅ Todos os componentes são standalone
- ✅ Estrutura de pastas mais plana (sem subpastas desnecessárias)

---

## Comandos Úteis Angular CLI (v21)

```bash
# Criar novo componente STANDALONE (padrão)
ng generate component features/products/components/product-list
ng g c features/products/components/product-list

# Criar componente com todas as opções standalone explícitas
ng g c features/products/product-detail --standalone --inline-style --inline-template

# Criar serviço
ng generate service core/services/auth
ng g s core/services/auth

# Criar guard FUNCIONAL (padrão)
ng generate guard core/guards/auth
ng g g core/guards/auth
# Selecione: CanActivate (funcional)

# Criar interceptor FUNCIONAL (padrão)
ng generate interceptor core/interceptors/auth
ng g interceptor core/interceptors/auth

# Criar pipe standalone
ng generate pipe shared/pipes/truncate
ng g p shared/pipes/truncate --standalone

# Criar directive standalone
ng generate directive shared/directives/highlight
ng g d shared/directives/highlight --standalone

# Criar interface/model
ng generate interface core/models/user
ng g i core/models/user

# Criar arquivo de rotas
ng generate config app --type routes
# Cria app.routes.ts

# Criar environment
ng generate environments

# Build para produção
ng build --configuration production

# Servir com SSR (Server-Side Rendering)
ng serve --ssr

# Atualizar Angular
ng update @angular/core @angular/cli

# Adicionar biblioteca
ng add @angular/material  # Adiciona Angular Material
ng add @ngrx/store        # Adiciona NgRx
```

### Opções importantes do CLI

```bash
# Gerar componente standalone (PADRÃO no Angular 17+)
ng g c my-component

# Gerar componente com módulo (LEGADO, não recomendado)
ng g c my-component --standalone false

# Criar com inline template e styles
ng g c my-component --inline-style --inline-template

# Criar sem arquivo de teste
ng g c my-component --skip-tests

# Criar em dry-run (visualizar sem criar)
ng g c my-component --dry-run
```

### Converter projeto legado para standalone

```bash
# Migração automática (Angular 16+)
ng generate @angular/core:standalone
```

---

## Checklist de Boas Práticas Angular 20/21

- [ ] Todos os componentes são **standalone** (sem NgModules)
- [ ] Usar `inject()` ao invés de constructor injection
- [ ] Usar **Signals** para state management local
- [ ] Usar **nova sintaxe de control flow** (@if, @for, @switch)
- [ ] Usar **input/output signals** ao invés de @Input/@Output
- [ ] Guards e interceptors são **funcionais** (não classes)
- [ ] Features organizadas por domínio (não por tipo)
- [ ] Lazy loading implementado para features
- [ ] Path aliases configurados no tsconfig (@app, @core, @shared)
- [ ] Environments separados (dev/prod) se necessário
- [ ] Assets organizados por tipo
- [ ] Modelos/Interfaces tipados
- [ ] Serviços com `providedIn: 'root'`
- [ ] Componentes seguindo Single Responsibility
- [ ] Smart vs Presentation components separados
- [ ] Testes unitários para componentes críticos
- [ ] ESLint configurado (ao invés de TSLint)
- [ ] Prettier configurado para formatação

---

## Recursos Adicionais

- [Angular.dev (Nova Documentação Oficial)](https://angular.dev)
- [Angular CLI Documentation](https://angular.io/cli)
- [Angular Signals Guide](https://angular.dev/guide/signals)
- [Angular Control Flow Guide](https://angular.dev/guide/templates/control-flow)
- [RxJS Best Practices](https://rxjs.dev/guide/overview)
- [Angular Update Guide](https://update.angular.io/)

---

## Migração Angular 11 → Angular 20/21

### Passos principais:

1. **Atualizar para Angular 15** (suporte a standalone)
2. **Converter para standalone components** gradualmente
3. **Atualizar para Angular 17** (control flow, signals)
4. **Migrar guards/interceptors** para funcionais
5. **Adotar signals** para state management
6. **Atualizar para Angular 20/21**

### Comando de migração automática:

```bash
# Migrar para standalone
ng generate @angular/core:standalone

# Atualizar versão
ng update @angular/core@21 @angular/cli@21
```

---

## Diferenças-chave: Angular 11 vs Angular 20/21

| Recurso                  | Angular 11             | Angular 20/21               |
| ------------------------ | ---------------------- | --------------------------- |
| **Arquitetura**          | NgModules obrigatórios | Standalone components       |
| **State Management**     | RxJS BehaviorSubject   | Signals                     |
| **Control Flow**         | *ngIf, *ngFor          | @if, @for, @switch          |
| **Inputs/Outputs**       | @Input, @Output        | input(), output()           |
| **Dependency Injection** | Constructor            | inject() function           |
| **Guards**               | Classes (CanActivate)  | Funções (CanActivateFn)     |
| **Interceptors**         | Classes                | Funções (HttpInterceptorFn) |
| **Bundler**              | Webpack                | Vite                        |
| **TypeScript**           | 4.8                    | 5.4+                        |
| **Configuração**         | app.module.ts          | app.config.ts               |
| **Rotas**                | \*-routing.module.ts   | \*.routes.ts                |

ng generate @angular/core:standalone

````

---

## Checklist de Boas Práticas Angular 20/21

- [ ] Todos os componentes são **standalone** (sem NgModules)
- [ ] Usar `inject()` ao invés de constructor injection
- [ ] Usar **Signals** para state management local
- [ ] Usar **nova sintaxe de control flow** (@if, @for, @switch)
- [ ] Usar **input/output signals** ao invés de @Input/@Output
- [ ] Guards e interceptors são **funcionais** (não classes)
- [ ] Features organizadas por domínio (não por tipo)
- [ ] Lazy loading implementado para features
- [ ] Path aliases configurados no tsconfig (@app, @core, @shared)
- [ ] Environments separados (dev/prod) se necessário
- [ ] Assets organizados por tipo
- [ ] Modelos/Interfaces tipados
- [ ] Serviços com `providedIn: 'root'`
- [ ] Componentes seguindo Single Responsibility
- [ ] Smart vs Presentation components separados
- [ ] Testes unitários para componentes críticos
- [ ] ESLint configurado (ao invés de TSLint)
- [ ] Prettier configurado para formatação

---

## Recursos Adicionais

- [Angular.dev (Nova Documentação Oficial)](https://angular.dev)
- [Angular CLI Documentation](https://angular.io/cli)
- [Angular Signals Guide](https://angular.dev/guide/signals)
- [Angular Control Flow Guide](https://angular.dev/guide/templates/control-flow)
- [RxJS Best Practices](https://rxjs.dev/guide/overview)
- [Angular Update Guide](https://update.angular.io/)

---

## Migração Angular 11 → Angular 20/21

### Passos principais

1. **Atualizar para Angular 15** (suporte a standalone)
2. **Converter para standalone components** gradualmente
3. **Atualizar para Angular 17** (control flow, signals)
4. **Migrar guards/interceptors** para funcionais
5. **Adotar signals** para state management
6. **Atualizar para Angular 20/21**

### Comando de migração automática

```bash
# Migrar para standalone
ng generate @angular/core:standalone

# Atualizar versão
ng update @angular/core@21 @angular/cli@21
````

---

## Diferenças-chave: Angular 11 vs Angular 20/21

| Recurso                  | Angular 11             | Angular 20/21               |
| ------------------------ | ---------------------- | --------------------------- |
| **Arquitetura**          | NgModules obrigatórios | Standalone components       |
| **State Management**     | RxJS BehaviorSubject   | Signals                     |
| **Control Flow**         | *ngIf,*ngFor           | @if, @for, @switch          |
| **Inputs/Outputs**       | @Input, @Output        | input(), output()           |
| **Dependency Injection** | Constructor            | inject() function           |
| **Guards**               | Classes (CanActivate)  | Funções (CanActivateFn)     |
| **Interceptors**         | Classes                | Funções (HttpInterceptorFn) |
| **Bundler**              | Webpack                | Vite                        |
| **TypeScript**           | 4.8                    | 5.4+                        |
| **Configuração**         | app.module.ts          | app.config.ts               |
| **Rotas**                | \*-routing.module.ts   | \*.routes.ts                |

---

**Criado por:** Claude AI  
**Data:** Fevereiro 2026  
**Versão Angular:** 20/21 (Standalone Architecture)  
**Última atualização:** 04/02/2026
