# Angular 19 & Express Chat Application

A real-time chat application built with Angular 19 frontend and Express.js backend.

## Overview

This project is a full-stack chat application that enables real-time messaging between users. The frontend is built with Angular 19, while the backend is powered by Express.js with WebSocketServer for real-time communication.

## Features

- Real-time messaging
- User authentication and profiles
<!--
- Message history
- Typing indicators
- Online/offline status
- Read receipts
- File sharing support
-->

## Tech Stack

### Frontend

- TailwindCSS
- Angular Material UI
- Spartan NG
- Angular 19
- RxJS
- TypeScript

### Backend

- Express.js
- WebSocket
- MongoDB (database)
- JWT Authentication
- Node.js

## Prerequisites

- Node.js (v18.x or later)
- npm (v9.x or later)
- MongoDB (v6.x or later)
- Angular CLI (v19.x)

## Installation

### Clone the repository

```bash
git clone https://github.com/zura156/chat-app.git
cd chat-app
```

### Backend Setup

```bash
# Navigate to server directory
cd server

# Install dependencies
npm install

# Create a .env file and configure environment variables
touch .env

# Start the server
npm run dev
```

### Frontend Setup

```bash
# Navigate to client directory
cd ../

# Install dependencies
npm install

# Start the Angular development server
ng serve
```

## Project Structure

```
chat-app/                  # Angular 19 frontend
│   src/
│   ├── app/
│   │   ├── features/        # Main features of the app
|   │   │   ├── auth/        # Auth pages
|   │   │   ├── messages/    # Chatbox
|   │   │   └── user/        # User pages (Profile, Change password, etc.)
│   │   ├── shared/
|   │   │   ├── directives/  # Angular directives
|   │   │   ├── interfaces/  # Angular interfaces
|   │   │   ├── layout/      # Page layout
|   │   │   ├── pipes/       # Angular pipes
|   │   │   └── services/    # Angular services
│   ├── public/          # Static assets
│   └── environments/    # Environment configurations
├── server/              # Express.js backend (TypeScript)
│   ├── auth/            # Authentication/Authorization API
│   ├── config/          # Environment configuration
│   ├── error-handling/  # Tools for error-handling
│   ├── messenger/       # Messaging methods
│   ├── user/            # User methods
│   ├── utils/           # Shared utilities
│   ├── websocket/       # WebSocket configuration
│   ├── index.ts         # Express app entry point
│   ├── package-lock.json
│   ├── package.json
│   ├── tsconfig.json
│   └── .gitignore
├── .editorconfig
├── .gitignore
├── .postcssrc.json
├── angular.json
├── components.json       # Spartan NG components config
├── package-lock.json
├── package.json
├── README.md
├── tsconfig.app.json
├── tsconfig.json
└── tsconfig.spec.json
```

## API Endpoints

### Authentication

- `POST /auth/register` - Register a new user
- `POST /auth/login` - Login user
- `GET /auth/profile` - Get user profile

### Messages

- `GET /message/conversation/:conversationId/messages` - Get messages for a conversation
- `POST /message/send` - Send a new message
- `DELETE /messages/:messageId` - Delete a message

### Conversations

- `GET /message/conversation` - Get user conversations
- `GET /message/conversation/:id` - Get conversation by ID
- `POST /message/conversation` - Create a new conversation

## Socket Events

### Under development.
_Events do exist, but there are more events that must be added._
<!--
### Client Events

- `register` - Register a client in socket
- `message` - Send a message
- `typing` - User is typing
- `stop_typing` - User stopped typing
- `read_receipt` - Mark messages as read
### Server Events

- `message` - New message received
- `user_joined` - User joined the chat
- `user_typing` - User is typing
- `user_stopped_typing` - User stopped typing
- `message_read` - Message read receipt
-->

## Environment Variables

### Backend (.env)

```
PORT=3000
WS_PORT=3001
MONGO_URI=your_mongo_uri
JWT_SECRET=your_jwt_secret
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d

```

### Frontend (environment.ts)

```typescript
export const environment = {
  production: false,
  apiUrl: "http://localhost:3000",
  wsUrl: "http://localhost:3000",
};
```

## Deployment

### Backend

```bash
cd server
npm run build
npm start
```

### Frontend

```bash
cd ./chat-app
ng build --configuration production
```

The Angular build artifacts will be stored in the `client/dist/` directory, which can be deployed to any static hosting service.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Angular team for the great framework
- Express.js community
- WebSocketServer for real-time communication capabilities
