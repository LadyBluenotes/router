---
title: Project Structure
---

TanStack Router uses a nested route tree to map your project's file structure directly to your application's URL hierarchy and component tree.

## How Route Trees Work

Nested routing allows you to use a URL to render a nested component tree. For example, given the URL of `/blog/posts/123`, you could create a route hierarchy that looks like this:

```
/routes
├── blog
│   ├── posts
│   │   ├── $postId.tsx
```

This structure would render a component tree that would look like this:

```tsx
<Blog>
  <Posts>
    <Post postId="123" />
  </Posts>
</Blog>
```

In larger applications, your route tree might look something like this:

```
/routes
├── __root.tsx
├── index.tsx
├── about.tsx
├── posts/
│   ├── index.tsx
│   ├── $postId.tsx
├── posts.$postId.edit.tsx
├── settings/
│   ├── profile.tsx
│   ├── notifications.tsx
├── _pathlessLayout/
│   ├── route-a.tsx
├── ├── route-b.tsx
├── files/
│   ├── $.tsx
```

Each file and folder in the `/routes` directory corresponds to a specific route in your application, allowing TanStack Router to automatically generate the necessary routing logic based on your file structure.

### File-Based vs Code-Based Routing

TanStack Router offers flexible configuration options for building your route tree:

- [File-Based Routing](../file-based-routing.md) - Automatically generates routes from your project's file structure
- [Code-Based Routing](../code-based-routing.md) - Manually define routes using code

**File-based routing is the recommended approach** as it reduces boilerplate and uses conventions to achieve the same results as code-based routing with less code. File-based routing also offers multiple organizational styles that you can choose from based on your project's needs:

- [Flat Routes](../file-based-routing.md#flat-routes) - Define all routes in a single directory
- [Directories](../file-based-routing.md#directory-routes) - Organize routes into nested directories that mirror your URL structure
- [Mixed Flat Routes and Directories](../file-based-routing.md#mixed-flat-and-directory-routes) - A combination of flat routes and directories.
- [Virtual File Routes](../virtual-file-routes.md) - Allow you to programmatically build a route tree using code that references files within your project.

Each method has its own use cases and benefits, allowing you to choose the best approach for your application's needs.
