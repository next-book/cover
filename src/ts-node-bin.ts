#!/usr/bin/env npx ts-node
import main from './index'

if (process.env.NODE_ENV !== 'test') main(process.argv[2])