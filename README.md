# Angular 19 & Express Chat Application

A real-time chat application built with Angular 19 frontend and Express.js backend.

## Overview

This project is a full-stack chat application that enables real-time messaging between users. The frontend is built with Angular 19, while the backend is powered by Express.js with Socket.IO for real-time communication.

## Features

- Real-time messaging
- User authentication and profiles
- Message history
- Typing indicators
- Online/offline status
- Read receipts
- File sharing support

## Tech Stack

### Frontend

- Angular 19
- Socket.IO Client
- Angular Material UI
- RxJS
- TypeScript

### Backend

- Express.js
- Socket.IO
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
git clone https://github.com/yourusername/angular-express-chat.git
cd angular-express-chat
```

### Backend Setup

```bash
# Navigate to server directory
cd server

# Install dependencies
npm install

# Create a .env file and configure environment variables
cp .env.example .env

# Start the server
npm run dev
```

### Frontend Setup

```bash
# Navigate to client directory
cd ../client

# Install dependencies
npm install

# Start the Angular development server
ng serve
```

## Project Structure

```
angular-express-chat/
├── client/                  # Angular 19 frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── components/  # Angular components
│   │   │   ├── services/    # Angular services
│   │   │   ├── models/      # TypeScript interfaces
│   │   │   └── guards/      # Auth guards
│   │   ├── assets/          # Static assets
│   │   └── environments/    # Environment configurations
├── server/                  # Express.js backend
│   ├── controllers/         # Request handlers
│   ├── middleware/          # Express middleware
│   ├── models/              # MongoDB models
│   ├── routes/              # API routes
│   ├── socket/              # Socket.IO configuration
│   └── app.js               # Express app entry point
├── .gitignore
├── README.md
└── package.json
```

## API Endpoints

### Authentication

- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/profile` - Get user profile

### Messages

- `GET /api/messages/:conversationId` - Get messages for a conversation
- `POST /api/messages` - Send a new message
- `DELETE /api/messages/:messageId` - Delete a message

### Conversations

- `GET /api/conversations` - Get user conversations
- `GET /api/conversations/:id` - Get conversation by ID
- `POST /api/conversations` - Create a new conversation

## Socket Events

### Client Events

- `join` - Join a room
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

## Environment Variables

### Backend (.env)

```
PORT=3000
MONGODB_URI=mongodb://localhost:27017/chat-app
JWT_SECRET=your_jwt_secret
JWT_EXPIRY=7d
NODE_ENV=development
```

### Frontend (environment.ts)

```typescript
export const environment = {
  production: false,
  apiUrl: "http://localhost:3000/api",
  socketUrl: "http://localhost:3000",
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
cd client
ng build --configuration production
```

The Angular build artifacts will be stored in the `client/dist/` directory, which can be deployed to any static hosting service.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Angular team for the great framework
- Express.js community
- Socket.IO for real-time communication capabilities
